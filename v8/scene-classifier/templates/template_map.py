"""
场景回应模板映射
"""

TEMPLATE_MAP = {
    "task_multi_step": """【任务提交】
任务已提交（ID: {task_id}），预计 {duration} 完成。
你可以通过 `/api/task/{task_id}` 查询状态，或直接问我"任务 {task_id} 怎么样了"。
{extra_warning}""",

    "fault_recovery": """【故障恢复】
先尝试以下恢复步骤：
{recovery_steps}

注意：{lesson}""",

    "vague_request": """【澄清意图】
我不太确定你具体需要什么。你可能想：
{options}
请告诉我你更倾向哪一个？""",

    "expert_user": """【专家模式】
{expert_answer}""",

    "novice_user": """【新手指引】
{explanation}

操作步骤：
{steps}""",

    "task_status_query": """【任务状态】
任务 {task_id}：
- 状态：{status}
- 进度：{progress}%
{extra_info}""",

    "cancel_task": """【取消任务】
正在取消任务 {task_id}...
结果：{result}""",

    "high_risk_automated": """[!WARNING] 此操作具有风险，{risk_description}

任务已提交（ID: {task_id}）。
回滚方法：{rollback}
建议先在测试环境验证。""",

    "chitchat": """【闲聊回应】
{response}""",

    "clarify": """【需要澄清】
我无法完全确定你的意图。你可能想：
{candidates}
能否再详细描述一下你的需求？""",

    "default": """{response}""",
}