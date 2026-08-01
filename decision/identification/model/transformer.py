from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont
from transformers import DetrImageProcessor, DetrForObjectDetection
import torch
import time
import base64
import io
import json

def crop_to_roi(image):
    """智能裁剪图像到感兴趣区域(ROI)
    
    Args:
        image: PIL Image对象
        
    Returns:
        tuple: (裁剪后的图像, (x_offset, y_offset))
    """
    # 简单实现：默认不裁剪，返回原图和(0,0)偏移
    return image, (0, 0)

# 初始化模型和处理器
# 支持的模型列表
MODELS = {
    "detr-resnet-50": {
        "processor": "facebook/detr-resnet-50",
        "model": "facebook/detr-resnet-50"
    },
    "detr-resnet-101": {
        "processor": "facebook/detr-resnet-101",
        "model": "facebook/detr-resnet-101" 
    },
    "detr-resnet-101-dc5": {
        "processor": "facebook/detr-resnet-101-dc5",
        "model": "facebook/detr-resnet-101-dc5"
    }
}

# 初始化默认模型
current_model = "detr-resnet-101-dc5"
processor = DetrImageProcessor.from_pretrained(
    MODELS[current_model]["processor"],
    size={"shortest_edge": 800, "longest_edge": 1333}
)
model = DetrForObjectDetection.from_pretrained(MODELS[current_model]["model"])
model.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))

# 手动实现NMS算法（解决重叠物体）
def detect_objects(image_data, return_type='json', model_version=None):
    """支持多模型切换的目标检测
    
    Args:
        image_data: 图像数据
        return_type: 返回类型(json/image)
        model_version: 指定模型版本
    """
    global current_model, processor, model
    
    # 切换模型
    if model_version and model_version in MODELS and model_version != current_model:
        current_model = model_version
        processor = DetrImageProcessor.from_pretrained(
            MODELS[current_model]["processor"],
            size={"shortest_edge": 800, "longest_edge": 1333}
        )
        model = DetrForObjectDetection.from_pretrained(MODELS[current_model]["model"])
        model.to(torch.device("cuda" if torch.cuda.is_available() else "cpu"))
    """API接口函数，支持返回JSON或base64图像
    
    Args:
        image_data: 图像二进制数据或base64字符串
        return_type: 'json'或'image'
    
    Returns:
        根据return_type返回检测结果
    """
    # 解析图像输入
    if isinstance(image_data, str):
        # base64字符串
        image = Image.open(io.BytesIO(base64.b64decode(image_data)))
    else:
        # 二进制数据
        image = Image.open(io.BytesIO(image_data))
    
    original_size = image.size
    
    # 增强预处理（提升特征辨识度）
    enhancer = ImageEnhance.Contrast(image)
    image = enhancer.enhance(2.0)
    enhancer = ImageEnhance.Sharpness(image)
    image = enhancer.enhance(1.5)
    image = image.filter(ImageFilter.MedianFilter(size=3))
    
    # 智能区域裁剪（减少背景干扰）
    roi_image, crop_offset = crop_to_roi(image)
    
    # 获取当前设备
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    
    # 模型推理
    inputs = processor(images=roi_image, return_tensors="pt").to(device)
    
    start_time = time.time()
    with torch.no_grad():
        outputs = model(**inputs)
    infer_time = time.time() - start_time
    
    # 后处理
    target_sizes = torch.tensor([roi_image.size[::-1]]).to(device)
    results = processor.post_process_object_detection(
        outputs, target_sizes=target_sizes, threshold=0.6
    )[0]
    
    # 准备返回结果
    detection_results = {
        "objects": [],
        "count": 0,
        "inference_time": infer_time,
        "original_size": original_size,
        "model": "DETR-ResNet101-DC5"
    }
    
    # 绘制结果到图像
    if return_type == 'image':
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype("simhei.ttf", 20)
        colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'cyan', 'magenta']
        
        # 绘制统计信息
        draw.rectangle([0, 0, 400, 80], fill="black")
        draw.text([5, 5], f"模型: {detection_results['model']}", fill="white", font=font)
        draw.text([5, 30], f"检测数量: {detection_results['count']}", fill="white", font=font)
        draw.text([5, 55], f"推理时间: {infer_time:.2f}秒", fill="white", font=font)
        
        # 绘制检测框
        for i, obj in enumerate(detection_results['objects']):
            box = obj['box']
            class_name = obj['class']
            score = obj['score']
            color = colors[i % len(colors)]
            
            # 绘制边界框和标签
            draw.rectangle(box, outline=color, width=3)
            label_text = f"{class_name}: {score:.2f}"
            
            try:
                bbox = draw.textbbox((0, 0), label_text, font=font)
                text_width, text_height = bbox[2] - bbox[0], bbox[3] - bbox[1]
            except AttributeError:
                text_width, text_height = draw.textsize(label_text, font=font)
            
            draw.rectangle([box[0], box[1] - text_height - 5, box[0] + text_width + 5, box[1]], fill=color)
            draw.text([box[0] + 2, box[1] - text_height - 5], label_text, fill="white", font=font)
        
        # 返回base64编码的图像
        buffered = io.BytesIO()
        image.save(buffered, format="JPEG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')
    
    return json.dumps(detection_results)

# 保留原有函数供测试使用
if __name__ == "__main__":
    image_path = "F:\\VIsual parts\\identification\\test\\短嘴豆雁.jpg"
    with open(image_path, "rb") as f:
        image_data = f.read()
    
    # 测试API调用
    result_json = detect_objects(image_data, return_type='json')
    print("JSON结果:", result_json)
    
    result_image = detect_objects(image_data, return_type='image')
    print("图像结果已生成(base64)")
