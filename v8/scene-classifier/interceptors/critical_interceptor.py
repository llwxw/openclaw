"""
硬拦截层：CRITICAL 请求直接拒绝
"""
import re

CRITICAL_PATTERNS = [
    (r"格式化.*磁盘|format.*disk", "格式化磁盘会导致数据永久丢失。若需清理磁盘空间，请手动删除不需要的文件。"),
    (r"关闭.*防火墙|disable.*firewall", "防火墙是重要安全屏障。若需开放端口，请使用精确规则如 `ufw allow 22/tcp`。"),
    (r"写.*病毒|写.*木马|write.*malware|钓鱼|exploit", "我无法提供恶意代码或攻击工具。"),
    (r"破解.*密码|盗取.*账号|获取.*隐私", "我无法协助获取他人隐私信息。"),
]


def critical_intercept(user_input: str):
    """返回 None 表示未拦截，否则返回拒绝响应"""
    for pattern, response in CRITICAL_PATTERNS:
        if re.search(pattern, user_input, re.IGNORECASE):
            return response
    return None