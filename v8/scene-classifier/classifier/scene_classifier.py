"""
带元判断的场景分类器
"""
import numpy as np
import pickle
import os

class SceneClassifier:
    def __init__(self, model_name="paraphrase-multilingual-MiniLM-L12-v2"):
        self.model_name = model_name
        self.encoder = None
        self.labels = []
        self.embeddings = []
        self.label_ids = []
        self.knn = None
        self.confidence_threshold = 0.5
        self.ambiguity_gap = 0.1
        self.label_to_id = {}

    def _load_encoder(self):
        if self.encoder is None:
            try:
                os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
                from sentence_transformers import SentenceTransformer
                self.encoder = SentenceTransformer(self.model_name)
            except ImportError:
                raise ImportError("sentence-transformers not installed")

    def fit(self, texts, labels):
        """训练:计算嵌入向量并建立KNN索引"""
        self._load_encoder()

        self.labels = list(set(labels))
        self.label_to_id = {l: i for i, l in enumerate(self.labels)}

        self.embeddings = self.encoder.encode(texts, show_progress_bar=True)
        self.label_ids = [self.label_to_id[l] for l in labels]

        from sklearn.neighbors import NearestNeighbors
        self.knn = NearestNeighbors(n_neighbors=3, metric="cosine")
        self.knn.fit(self.embeddings)

    def predict(self, text):
        """
        预测场景标签,返回带元判断的结果
        Returns:
        dict: {
            "label": str or None,
            "confidence": float,
            "meta": "confident" | "low_confidence" | "ambiguous",
            "top_candidates": list of (label, confidence)
        }
        """
        self._load_encoder()

        vec = self.encoder.encode([text])
        distances, indices = self.knn.kneighbors(vec)

        weights = 1 - distances[0]  # cosine距离转相似度
        top_conf = float(weights[0])  # 转换为Python原生类型

        # 构建候选列表
        candidates = []
        for idx, w in zip(indices[0], weights):
            lbl = self.labels[self.label_ids[idx]]
            candidates.append((lbl, float(w)))  # 转换为Python原生类型

        # 元判断1：置信度不足
        if top_conf < self.confidence_threshold:
            return {
                "label": None,
                "confidence": top_conf,
                "meta": "low_confidence",
                "top_candidates": candidates[:2]
            }

        # 元判断2：top2差距过小（歧义）
        if len(weights) >= 2:
            gap = float(weights[0] - weights[1])  # 转换为Python原生类型
            if gap < self.ambiguity_gap:
                return {
                    "label": None,
                    "confidence": top_conf,
                    "meta": "ambiguous",
                    "top_candidates": candidates[:2]
                }

        best_label = candidates[0][0]
        return {
            "label": best_label,
            "confidence": top_conf,
            "meta": "confident",
            "top_candidates": candidates[:2]
        }

    def save(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            pickle.dump({
                'encoder_name': self.model_name,
                'labels': self.labels,
                'label_to_id': self.label_to_id,
                'embeddings': self.embeddings,
                'label_ids': self.label_ids,
                'confidence_threshold': self.confidence_threshold,
                'ambiguity_gap': self.ambiguity_gap,
            }, f)

    @classmethod
    def load(cls, path):
        with open(path, 'rb') as f:
            data = pickle.load(f)

        obj = cls(model_name=data['encoder_name'])
        obj._load_encoder()

        obj.labels = data['labels']
        obj.label_to_id = data['label_to_id']
        obj.embeddings = data['embeddings']
        obj.label_ids = data['label_ids']
        obj.confidence_threshold = data.get('confidence_threshold', 0.5)
        obj.ambiguity_gap = data.get('ambiguity_gap', 0.1)

        from sklearn.neighbors import NearestNeighbors
        obj.knn = NearestNeighbors(n_neighbors=3, metric="cosine")
        obj.knn.fit(obj.embeddings)
        return obj