#!/usr/bin/env python3
"""Download and rewrite BS-RoFormer fp16 ONNX for ONNX Runtime WebGPU.

The public ONNX has Concat/Split patterns that can exceed the common WebGPU
storage-buffer limit per shader stage. This script rewrites large
Concat/Split nodes into cascaded smaller nodes and writes an ignored local
model file under public/models/.
"""

from __future__ import annotations

import argparse
import tempfile
import urllib.request
from collections import defaultdict, deque
from pathlib import Path


BASE_MODEL_URL = "https://huggingface.co/xycld/BS-RoFormer-ONNX/resolve/main"
MODEL_VARIANTS = {
    "fp16": {
        "label": "BS-RoFormer fp16",
        "files": [
            "bs_roformer_ep317_sdr12.9755.onnx",
            "bs_roformer_ep317_sdr12.9755.onnx.data",
        ],
        "entry": "bs_roformer_ep317_sdr12.9755.onnx",
        "output": Path("public/models/bs-roformer-fp16-webgpu.onnx"),
    },
}


def require_dependencies():
    try:
        import numpy  # noqa: F401
        import onnx  # noqa: F401
        import onnxconverter_common  # noqa: F401
    except ModuleNotFoundError as error:
        missing = error.name or "onnx"
        raise SystemExit(
            f"Python dependency '{missing}' is missing.\n"
            "Run through the Bun script so dependencies are installed into .tmp/onnx-tools:\n"
            "  bun run prepare:bs-roformer-webgpu\n"
        ) from error


def download_file(url: str, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading:\n  {url}")
    last_percent = -1

    def report(block_count: int, block_size: int, total_size: int):
        nonlocal last_percent
        if total_size <= 0:
            return
        loaded = min(block_count * block_size, total_size)
        percent = loaded / total_size * 100
        current_percent = int(percent)
        if current_percent == last_percent and loaded < total_size:
            return

        last_percent = current_percent
        print(
            f"  {loaded / 1024 / 1024:7.1f} / {total_size / 1024 / 1024:7.1f} MiB ({percent:5.1f}%)",
            flush=True,
        )

    urllib.request.urlretrieve(url, path, reporthook=report)


def download_variant(tmp_dir: Path, variant: str) -> Path:
    config = MODEL_VARIANTS[variant]

    for file_name in config["files"]:
        download_file(f"{BASE_MODEL_URL}/{file_name}", tmp_dir / file_name)

    return tmp_dir / config["entry"]


def internalize_external_data(onnx_path: Path, out_path: Path):
    import onnx

    print("Internalizing external ONNX tensor data...")
    model = onnx.load(onnx_path, load_external_data=True)

    for tensor in model.graph.initializer:
        tensor.ClearField("data_location")
        del tensor.external_data[:]

    onnx.save(model, out_path)


def convert_model_to_fp16(onnx_path: Path, out_path: Path):
    import onnx
    from onnxconverter_common.float16 import (
        DEFAULT_OP_BLOCK_LIST,
        convert_float_to_float16,
    )

    stable_fp32_ops = [
        "Softmax",
        "ReduceL2",
        "Clip",
        "Div",
        "Erf",
        "Sqrt",
        "Exp",
        "Log",
        "Pow",
    ]
    op_block_list = sorted({*DEFAULT_OP_BLOCK_LIST, *stable_fp32_ops})

    print("Converting fp32 ONNX to mixed fp16 with fp32 I/O...")
    print(f"Keeping numerically sensitive ops in fp32: {', '.join(stable_fp32_ops)}")
    model = onnx.load(onnx_path)
    fp16_model = convert_float_to_float16(
        model,
        keep_io_types=True,
        op_block_list=op_block_list,
        disable_shape_infer=True,
    )
    onnx.save(fp16_model, out_path)


def cascade_large_ops(onnx_path: Path, out_path: Path, max_bindings: int = 7):
    import numpy as np
    import onnx
    from onnx import helper, numpy_helper, shape_inference

    print(f"Rewriting large Split/Concat ops to <= {max_bindings} bindings...")
    model = onnx.load(onnx_path)
    graph = model.graph

    type_map = {}
    for value_info in list(graph.value_info) + list(graph.input) + list(graph.output):
        type_map[value_info.name] = value_info

    def get_shape(tensor_name: str):
        value_info = type_map.get(tensor_name)
        if value_info is None:
            return None

        try:
            dims = value_info.type.tensor_type.shape.dim
            shape = []
            for dim in dims:
                has_dim_value = dim.HasField("dim_value")
                dim_value = dim.dim_value if has_dim_value else None
                dim_param = dim.dim_param if dim.HasField("dim_param") else ""
                shape.append((dim_value, dim_param, has_dim_value))
            return shape
        except Exception:
            return None

    def get_elem_type(tensor_name: str) -> int:
        value_info = type_map.get(tensor_name)
        if value_info is None:
            return 1

        try:
            elem_type = value_info.type.tensor_type.elem_type
        except Exception:
            return 1

        return elem_type or 1

    def make_value_info(name: str, shape_dims, elem_type: int):
        value_info = helper.make_tensor_value_info(
            name,
            elem_type,
            [None] * len(shape_dims),
        )
        for index, (dim_value, dim_param, has_dim_value) in enumerate(shape_dims):
            dim = value_info.type.tensor_type.shape.dim[index]
            dim.Clear()
            if dim_param:
                dim.dim_param = dim_param
            elif has_dim_value and dim_value is not None:
                dim.dim_value = dim_value
        return value_info

    new_value_infos = []
    nodes_to_remove = []
    nodes_to_add = []
    counter = 0

    def uid():
        nonlocal counter
        counter += 1
        return counter

    def emit_split(input_name: str, output_names: list[str], sizes: list[int], axis: int):
        input_shape = get_shape(input_name)
        input_elem_type = get_elem_type(input_name)
        if input_shape:
            normalized_axis = axis if axis >= 0 else len(input_shape) + axis
            for output_index, output_name in enumerate(output_names):
                if output_name not in type_map:
                    shape = list(input_shape)
                    shape[normalized_axis] = (sizes[output_index], "", True)
                    value_info = make_value_info(output_name, shape, input_elem_type)
                    new_value_infos.append(value_info)
                    type_map[output_name] = value_info

        if len(output_names) <= max_bindings:
            sizes_name = f"_cascade_split_sizes_{uid()}"
            graph.initializer.append(
                numpy_helper.from_array(np.array(sizes, dtype=np.int64), name=sizes_name)
            )
            nodes_to_add.append(
                helper.make_node(
                    "Split",
                    inputs=[input_name, sizes_name],
                    outputs=output_names,
                    axis=axis,
                    name=f"cascade_split_{uid()}",
                )
            )
            return

        groups = [
            list(range(index, min(index + max_bindings, len(output_names))))
            for index in range(0, len(output_names), max_bindings)
        ]
        group_sizes = [sum(sizes[index] for index in group) for group in groups]
        group_outputs = [f"_cascade_split_group_{uid()}" for _ in groups]

        if input_shape:
            normalized_axis = axis if axis >= 0 else len(input_shape) + axis
            for group_index, group_output in enumerate(group_outputs):
                shape = list(input_shape)
                shape[normalized_axis] = (group_sizes[group_index], "", True)
                value_info = make_value_info(group_output, shape, input_elem_type)
                new_value_infos.append(value_info)
                type_map[group_output] = value_info

        emit_split(input_name, group_outputs, group_sizes, axis)

        for group_index, group in enumerate(groups):
            if len(group) == 1:
                nodes_to_add.append(
                    helper.make_node(
                        "Identity",
                        inputs=[group_outputs[group_index]],
                        outputs=[output_names[group[0]]],
                        name=f"cascade_split_identity_{uid()}",
                    )
                )
            else:
                emit_split(
                    group_outputs[group_index],
                    [output_names[index] for index in group],
                    [sizes[index] for index in group],
                    axis,
                )

    def cascade_split(node):
        if len(node.output) <= max_bindings:
            return

        split_sizes_name = node.input[1] if len(node.input) > 1 else None
        axis = 0
        for attr in node.attribute:
            if attr.name == "axis":
                axis = attr.i

        split_sizes = None
        if split_sizes_name:
            for initializer in graph.initializer:
                if initializer.name == split_sizes_name:
                    split_sizes = numpy_helper.to_array(initializer).tolist()
                    break

        if split_sizes is None:
            print(f"  Skipping Split '{node.name}' because sizes were not found.")
            return

        print(f"  Split '{node.name}': {len(node.output)} outputs")
        nodes_to_remove.append(node)
        emit_split(node.input[0], list(node.output), split_sizes, axis)

    def concat_shape(input_names: list[str], concat_axis: int):
        shapes = [get_shape(name) for name in input_names]
        if not all(shapes):
            return None

        base = list(shapes[0])
        normalized_axis = concat_axis if concat_axis >= 0 else len(base) + concat_axis
        total = 0

        for shape in shapes:
            dim_value, dim_param, has_dim_value = shape[normalized_axis]
            if dim_param or not has_dim_value:
                return None
            total += dim_value

        base[normalized_axis] = (total, "", True)
        return base

    def cascade_concat(node):
        if len(node.input) <= max_bindings:
            return

        axis = 0
        for attr in node.attribute:
            if attr.name == "axis":
                axis = attr.i

        print(f"  Concat '{node.name}': {len(node.input)} inputs")
        nodes_to_remove.append(node)

        valid_inputs = []
        for input_name in node.input:
            shape = get_shape(input_name)
            is_zero = False
            if shape:
                normalized_axis = axis if axis >= 0 else len(shape) + axis
                if 0 <= normalized_axis < len(shape):
                    dim_value, dim_param, has_dim_value = shape[normalized_axis]
                    is_zero = has_dim_value and dim_value == 0 and not dim_param
            if not is_zero:
                valid_inputs.append(input_name)

        if not valid_inputs and node.input:
            valid_inputs = [node.input[0]]

        group_outputs = []
        for index in range(0, len(valid_inputs), max_bindings):
            group = valid_inputs[index : index + max_bindings]
            if len(group) == 1:
                group_outputs.append(group[0])
                continue

            output_name = f"_cascade_concat_group_{uid()}"
            nodes_to_add.append(
                helper.make_node(
                    "Concat",
                    inputs=group,
                    outputs=[output_name],
                    axis=axis,
                    name=f"cascade_concat_inner_{uid()}",
                )
            )
            group_outputs.append(output_name)

            shape = concat_shape(group, axis)
            if shape:
                value_info = make_value_info(
                    output_name,
                    shape,
                    get_elem_type(group[0]),
                )
                new_value_infos.append(value_info)
                type_map[output_name] = value_info

        while len(group_outputs) > max_bindings:
            next_level = []
            for index in range(0, len(group_outputs), max_bindings):
                group = group_outputs[index : index + max_bindings]
                if len(group) == 1:
                    next_level.append(group[0])
                    continue

                output_name = f"_cascade_concat_level_{uid()}"
                nodes_to_add.append(
                    helper.make_node(
                        "Concat",
                        inputs=group,
                        outputs=[output_name],
                        axis=axis,
                        name=f"cascade_concat_level_{uid()}",
                    )
                )
                next_level.append(output_name)

                shape = concat_shape(group, axis)
                if shape:
                    value_info = make_value_info(
                        output_name,
                        shape,
                        get_elem_type(group[0]),
                    )
                    new_value_infos.append(value_info)
                    type_map[output_name] = value_info
            group_outputs = next_level

        nodes_to_add.append(
            helper.make_node(
                "Concat",
                inputs=group_outputs,
                outputs=[node.output[0]],
                axis=axis,
                name=f"cascade_concat_final_{uid()}",
            )
        )

    for node in list(graph.node):
        if node.op_type == "Split":
            cascade_split(node)
        elif node.op_type == "Concat":
            cascade_concat(node)

    for node in nodes_to_remove:
        graph.node.remove(node)
    graph.node.extend(nodes_to_add)

    producers = {}
    for index, node in enumerate(graph.node):
        for output_name in node.output:
            if output_name:
                producers[output_name] = index

    dependencies = defaultdict(set)
    users = defaultdict(set)
    indegree = [0] * len(graph.node)

    for index, node in enumerate(graph.node):
        for input_name in node.input:
            if not input_name:
                continue
            producer = producers.get(input_name)
            if producer is None or producer == index:
                continue
            if producer not in dependencies[index]:
                dependencies[index].add(producer)
                users[producer].add(index)
                indegree[index] += 1

    queue = deque(index for index, count in enumerate(indegree) if count == 0)
    order = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for next_index in users[current]:
            indegree[next_index] -= 1
            if indegree[next_index] == 0:
                queue.append(next_index)

    if len(order) != len(graph.node):
        raise RuntimeError("Failed to topologically sort rewritten ONNX graph.")

    sorted_nodes = [graph.node[index] for index in order]
    del graph.node[:]
    graph.node.extend(sorted_nodes)

    for value_info in new_value_infos:
        graph.value_info.append(value_info)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".onnx", delete=False) as tmp_file:
        tmp_path = Path(tmp_file.name)

    try:
        onnx.save(model, tmp_path)
        print("Running ONNX shape inference...")
        shape_inference.infer_shapes_path(tmp_path, out_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    verify_model(out_path, max_bindings)


def verify_model(path: Path, max_bindings: int):
    import onnx

    model = onnx.load(path)
    remaining = 0
    for node in model.graph.node:
        binding_count = 0
        if node.op_type == "Split":
            binding_count = len(node.output)
        elif node.op_type == "Concat":
            binding_count = len(node.input)

        if binding_count > max_bindings:
            remaining += 1
            print(f"  Remaining large {node.op_type}: {node.name} ({binding_count})")

    if remaining:
        raise RuntimeError(f"{remaining} large Split/Concat ops remain.")

    onnx.checker.check_model(model)
    print(f"Saved WebGPU-oriented model: {path}")
    print(f"Size: {path.stat().st_size / 1024 / 1024:.1f} MiB")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Prepare a BS-RoFormer ONNX model for ONNX Runtime WebGPU.",
    )
    parser.add_argument(
        "--variant",
        choices=sorted(MODEL_VARIANTS),
        default="fp16",
        help="Model variant to prepare.",
    )
    parser.add_argument(
        "output",
        nargs="?",
        help="Optional output path. Defaults to the variant-specific public/models path.",
    )
    return parser.parse_args()


def main():
    require_dependencies()
    args = parse_args()

    output = Path(args.output) if args.output else MODEL_VARIANTS[args.variant]["output"]

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        source = download_variant(tmp_path, args.variant)

        internalized = tmp_path / "bs-roformer-fp32-internal.onnx"
        internalize_external_data(source, internalized)

        fp16_source = tmp_path / "bs-roformer-fp16.onnx"
        convert_model_to_fp16(internalized, fp16_source)
        source = fp16_source

        cascade_large_ops(source, output)


if __name__ == "__main__":
    main()
