#!/usr/bin/env python3
"""
Scene Classifier API 服务
启动: python api_server.py
访问: http://localhost:8080
"""

import os
import sys
import json
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import time

# 配置目录
CONFIG_DIR = os.path.join(os.path.dirname(__file__), 'config')
RULES_FILE = os.path.join(CONFIG_DIR, 'rule_overrides.json')

# 添加路径
sys.path.insert(0, '/home/ai/.openclaw/workspace/skills/scene-classifier')

from pipeline.orchestrator import PipelineOrchestrator
from feedback.collector import FeedbackCollector
from classifier.rule_classifier import RuleClassifier

app = FastAPI(title="Scene Classifier API", version="2.0")

# CORS 支持
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化
try:
    pipeline = PipelineOrchestrator()
    feedback = FeedbackCollector()
    rule_classifier = RuleClassifier()
    print("Pipeline initialized")
except Exception as e:
    pipeline = None
    rule_classifier = RuleClassifier()
    print(f"Pipeline init failed: {e}, using rule-based fallback")

# 熔断器状态
circuit_breaker = {
    "failures": 0,
    "last_failure": 0,
    "is_open": False,
    "threshold": 3,  # 连续失败次数
    "timeout": 30,   # 30秒后尝试恢复
}

# 请求模型
class ClassifyRequest(BaseModel):
    text: str
    context: dict = {}

class FeedbackRequest(BaseModel):
    text: str
    predicted_label: str
    feedback_type: str
    correct_label: str = None

@app.get("/")
def root():
    return {
        "name": "Scene Classifier API",
        "version": "2.0",
        "endpoints": {
            "classify": "/classify (POST)",
            "feedback": "/feedback (POST)",
            "stats": "/stats (GET)",
        }
    }

@app.get("/health")
def health():
    return {
        "status": "ok",
        "pipeline_loaded": pipeline is not None,
        "circuit_breaker": {
            "is_open": circuit_breaker["is_open"],
            "failures": circuit_breaker["failures"]
        }
    }

@app.post("/classify")
def classify(req: ClassifyRequest):
    # 检查熔断器
    now = time.time()
    if circuit_breaker["is_open"]:
        if now - circuit_breaker["last_failure"] > circuit_breaker["timeout"]:
            # 尝试恢复
            circuit_breaker["is_open"] = False
            circuit_breaker["failures"] = 0
            print("Circuit breaker: attempting recovery")
        else:
            # 直接使用规则分类器
            result = rule_classifier.predict(req.text)
            result["meta"] = "circuit_open_fallback"
            return result
    
    if not pipeline:
        # 管道未初始化，使用规则分类器
        result = rule_classifier.predict(req.text)
        result["meta"] = "pipeline_unavailable"
        return result
    
    try:
        result = pipeline.process(req.text, req.context)
        # 成功，重置熔断器
        circuit_breaker["failures"] = 0
        return result
    except Exception as e:
        # 失败，增加计数
        circuit_breaker["failures"] += 1
        circuit_breaker["last_failure"] = now
        print(f"Classification failed: {e}, failures: {circuit_breaker['failures']}")
        
        if circuit_breaker["failures"] >= circuit_breaker["threshold"]:
            circuit_breaker["is_open"] = True
            print("Circuit breaker opened")
        
        # 降级到规则分类器
        result = rule_classifier.predict(req.text)
        result["meta"] = "fallback"
        result["error"] = str(e)
        return result

@app.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    if not feedback:
        raise HTTPException(status_code=500, detail="Feedback not initialized")
    
    return {"status": "recorded"}

@app.get("/stats")
def get_stats():
    return {"message": "Check logs/meta_events.jsonl"}

# ========== 热更新端点 ==========
@app.post("/reload-rules")
def reload_rules():
    global rule_classifier
    try:
        # 确保配置目录存在
        os.makedirs(CONFIG_DIR, exist_ok=True)
        
        # 如果存在覆盖规则文件，加载它
        if os.path.exists(RULES_FILE):
            with open(RULES_FILE, 'r', encoding='utf-8') as f:
                rule_overrides = json.load(f)
            # 重新初始化规则分类器
            rule_classifier = RuleClassifier(custom_rules=rule_overrides)
            return {
                "status": "reloaded",
                "rules_file": RULES_FILE,
                "rules_count": len(rule_overrides) if isinstance(rule_overrides, dict) else 0
            }
        else:
            return {
                "status": "no_override",
                "message": "No rule_overrides.json found"
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reload failed: {str(e)}")

@app.post("/update-rules")
def update_rules(rules: dict):
    """动态更新规则"""
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(RULES_FILE, 'w', encoding='utf-8') as f:
            json.dump(rules, f, ensure_ascii=False, indent=2)
        # 触发重载
        return reload_rules()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}")

@app.get("/rules")
def get_rules():
    """获取当前规则"""
    if os.path.exists(RULES_FILE):
        with open(RULES_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {"message": "No custom rules"}

if __name__ == "__main__":
    print("Scene Classifier API v2.0 starting on port 3104...")
    uvicorn.run(app, host="0.0.0.0", port=3105)