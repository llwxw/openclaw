"""
训练场景分类器
"""
import sys
import os

# 添加父目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

from data.synthetic_training_data import generate_training_data
from classifier.scene_classifier import SceneClassifier
import argparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", nargs="?", default="models/scene_classifier.pkl")
    args = parser.parse_args()
    
    # 生成训练数据
    data = generate_training_data()
    texts, labels = zip(*data)
    print(f"训练样本数：{len(texts)}，场景数：{len(set(labels))}")
    print(f"场景列表: {set(labels)}")
    
    # 训练
    clf = SceneClassifier()
    clf.fit(list(texts), list(labels))
    
    # 保存
    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    clf.save(args.output)
    print(f"模型已保存到 {args.output}")


if __name__ == "__main__":
    main()