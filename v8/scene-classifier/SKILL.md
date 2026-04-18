# Scene Classifier - 场景分类器

> 基于嵌入向量的轻量级场景分类系统

## 模块结构

```
scene-classifier/
├── SKILL.md                      # 本文件
├── __init__.py                   # 主入口
├── pipeline.py                   # Pipeline 编排器
├── data/
│   └── synthetic_training_data.py   # 训练数据构造
├── classifier/
│   └── scene_classifier.py          # 分类器模型
├── templates/
│   └── template_map.py               # 模板注入
├── scripts/
│   └── train_classifier.py           # 训练脚本
└── feedback/
    └── collector.py                  # 反馈收集
```

## 功能

| 模块 | 功能 |
|------|------|
| **硬拦截层** | CRITICAL 风险直接拦截，不经过 LLM |
| **场景分类器** | 基于 sentence-transformers 嵌入 + KNN |
| **模板注入** | 根据场景自动填充回复模板 |
| **后置校验** | 检查 [!WARNING] 等安全标签 |
| **反馈闭环** | 收集误分类，触发重训练 |

## 使用方式

```python
from scene_classifier import pipeline

result = pipeline.process("帮我分析代码质量")
print(result["response"])
```

## 依赖

```bash
pip install sentence-transformers scikit-learn numpy
```

## 训练分类器

```bash
python scripts/train_classifier.py models/scene_classifier.pkl
```

---
*version: 1.0*