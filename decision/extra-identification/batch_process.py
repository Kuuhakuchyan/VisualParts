from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
import torch
import time
import os
from tkinter import Tk, filedialog

# 手动实现NMS算法（解决重叠物体）
def non_max_suppression(boxes, scores, threshold=0.5):
    if boxes.numel() == 0:
        return torch.empty((0,), dtype=torch.long)
    
    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]
    
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort(descending=True)
    
    keep = []
    while order.numel() > 0:
        if order.numel() == 1:
            i = order.item()
            keep.append(i)
            break
        else:
            i = order[0].item()
            keep.append(i)
        
        xx1 = torch.max(x1[i], x1[order[1:]])
        yy1 = torch.max(y1[i], y1[order[1:]])
        xx2 = torch.min(x2[i], x2[order[1:]])
        yy2 = torch.min(y2[i], y2[order[1:]])
        
        w = torch.max(xx2 - xx1 + 1, torch.tensor(0.0))
        h = torch.max(yy2 - yy1 + 1, torch.tensor(0.0))
        inter = w * h
        
        iou = inter / (areas[i] + areas[order[1:]] - inter)
        
        inds = torch.where(iou <= threshold)[0]
        order = order[inds + 1]
    
    return torch.tensor(keep, dtype=torch.long)

# 智能区域裁剪（减少背景干扰）
def crop_to_roi(image, padding=0.15):
    width, height = image.size
    gray = image.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    
    edge_points = []
    for x in range(width):
        for y in range(height):
            if edges.getpixel((x, y)) > 100:
                edge_points.append((x, y))
    
    if not edge_points:
        return image, (0, 0)
    
    min_x = min(p[0] for p in edge_points)
    max_x = max(p[0] for p in edge_points)
    min_y = min(p[1] for p in edge_points)
    max_y = max(p[1] for p in edge_points)
    
    pad_x = int((max_x - min_x) * padding)
    pad_y = int((max_y - min_y) * padding)
    
    min_x = max(0, min_x - pad_x)
    max_x = min(width - 1, max_x + pad_x)
    min_y = max(0, min_y - pad_y)
    max_y = min(height - 1, max_y + pad_y)
    
    return image.crop((min_x, min_y, max_x, max_y)), (min_x, min_y)

def process_image(image_path, output_dir, processor, model, device, font):
    try:
        # 加载图像
        image = Image.open(image_path)
        
        # 增强预处理（提升特征辨识度）
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)  # 增强对比度，突出物体边缘
        
        enhancer = ImageEnhance.Sharpness(image)
        image = enhancer.enhance(1.5)  # 提升锐度，帮助识别细节
        
        image = image.filter(ImageFilter.MedianFilter(size=3))  # 中值滤波去除噪声
        
        # 应用裁剪
        roi_image, crop_offset = crop_to_roi(image)
        
        # 模型推理
        inputs = processor(images=roi_image, return_tensors="pt").to(device)
        
        start_time = time.time()
        with torch.no_grad():
            outputs = model(** inputs)
        infer_time = time.time() - start_time
        
        # 后处理
        target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
        results = processor.post_process_object_detection(
            outputs, target_sizes=target_sizes, threshold=0.6
        )[0]
        
        # 应用NMS过滤重叠框
        boxes = results["boxes"].cpu()
        scores = results["scores"].cpu()
        labels = results["labels"].cpu()
        keep_indices = non_max_suppression(boxes, scores, threshold=0.5)
        
        # 筛选结果并恢复原图坐标
        boxes = boxes[keep_indices]
        scores = scores[keep_indices]
        labels = labels[keep_indices]
        
        # 筛选出鸟类（通过标签名称判断）
        bird_indices = []
        for i, label in enumerate(labels):
            class_name = model.config.id2label[label.item()].lower()
            if "bird" in class_name:  # 检查标签名称是否包含"bird"
                bird_indices.append(i)
        bird_indices = torch.tensor(bird_indices, dtype=torch.long)
        
        # 更新结果为仅包含鸟类
        results["boxes"] = boxes[bird_indices]
        results["scores"] = scores[bird_indices]
        results["labels"] = labels[bird_indices]
        
        if len(results["boxes"]) > 0:
            results["boxes"][:, 0] += crop_offset[0]
            results["boxes"][:, 1] += crop_offset[1]
            results["boxes"][:, 2] += crop_offset[0]
            results["boxes"][:, 3] += crop_offset[1]
        
        # 绘制结果
        draw = ImageDraw.Draw(image)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        object_count = len(results["boxes"])
        
        # 绘制计数和信息
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: DETR-ResNet101-DC5", fill="white", font=font)
        draw.text([5, 30], f"检测鸟类数量: {object_count}", fill="white", font=font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=font)
        
        # 打印识别出的鸟类信息
        print(f"\n{os.path.basename(image_path)} 检测到 {object_count} 只鸟类")
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            class_name = model.config.id2label[label.item()]
            print(f"鸟类 {i+1}: {class_name} (置信度: {score:.2f})")
        
        # 绘制检测框和标签
        for i, (box, score, label) in enumerate(zip(results["boxes"], results["scores"], results["labels"])):
            box = [int(coord) for coord in box.tolist()]
            xmin, ymin, xmax, ymax = box
            class_name = model.config.id2label[label.item()]
            color = colors[i % len(colors)]
            
            # 绘制边界框
            draw.rectangle([xmin, ymin, xmax, ymax], outline=color, width=3)
            
            # 绘制标签
            label_text = f"{class_name}: {score:.2f}"
            
            # 兼容不同PIL版本的文本尺寸获取方法
            try:
                # 适用于PIL 8.0.0及更高版本
                bbox = draw.textbbox((0, 0), label_text, font=font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                # 适用于PIL旧版本
                text_width, text_height = draw.textsize(label_text, font=font)
            
            # 绘制文本背景框
            draw.rectangle([xmin, ymin - text_height - 5, xmin + text_width + 5, ymin], fill=color)
            # 绘制文本
            draw.text([xmin + 2, ymin - text_height - 5], label_text, fill="white", font=font)
        
        # 保存结果
        output_filename = f"result_{os.path.basename(image_path)}"
        result_path = os.path.join(output_dir, output_filename)
        image.save(result_path)
        print(f"结果已保存至: {result_path}")
        
    except Exception as e:
        print(f"处理 {image_path} 时出错: {str(e)}")

def main():
    # 选择输入文件夹
    root = Tk()
    root.withdraw()  # 隐藏主窗口
    print("请选择包含图片的文件夹...")
    input_dir = filedialog.askdirectory(title="选择图片文件夹")
    
    if not input_dir:
        print("未选择文件夹，程序退出")
        return
    
    # 创建输出文件夹
    output_dir = os.path.join(input_dir, "鸟类识别结果")
    os.makedirs(output_dir, exist_ok=True)
    
    # 支持的图片格式
    supported_formats = ('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff', '.webp')
    
    # 获取文件夹中所有支持的图片文件
    image_files = [
        f for f in os.listdir(input_dir)
        if os.path.isfile(os.path.join(input_dir, f)) and f.lower().endswith(supported_formats)
    ]
    
    if not image_files:
        print(f"在 {input_dir} 中未找到支持的图片文件")
        return
    
    print(f"找到 {len(image_files)} 个图片文件，开始处理...")
    
    # 加载模型和处理器
    processor = DetrImageProcessor.from_pretrained("facebook/detr-resnet-101-dc5")
    model = DetrForObjectDetection.from_pretrained("facebook/detr-resnet-101-dc5")
    
    # 设置设备
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    print(f"使用设备: {device.type.upper()}")
    
    # 加载字体
    try:
        font = ImageFont.truetype("simhei.ttf", 20)  # 使用黑体字体
    except IOError:
        try:
            # 尝试其他中文字体
            font = ImageFont.truetype("simsun.ttc", 20)
        except IOError:
            # 如果没有中文字体，使用默认字体
            font = ImageFont.load_default()
            print("警告: 无法加载中文字体，将使用默认字体")
    
    # 批量处理图片
    for i, image_file in enumerate(image_files, 1):
        image_path = os.path.join(input_dir, image_file)
        print(f"\n处理第 {i}/{len(image_files)} 个文件: {image_file}")
        process_image(image_path, output_dir, processor, model, device, font)
    
    print("\n所有图片处理完成！")
    print(f"所有结果已保存至: {output_dir}")

if __name__ == "__main__":
    main()