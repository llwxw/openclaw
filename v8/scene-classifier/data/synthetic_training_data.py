"""
生成训练数据（含新增chitchat场景）
"""
import os
import sys

SCENE_DEFINITIONS = {
    "task_multi_step": {
        "positive_examples": [
            "帮我分析这个项目的代码质量",
            "重构 src 目录下所有文件",
            "搭建一个完整的 React 项目",
            "扫描整个仓库找出安全问题",
            "批量重命名所有图片并按日期分类",
            "优化这个函数的性能",
            "帮我写一个完整的爬虫",
        ]
    },
    "fault_recovery": {
        "positive_examples": [
            "我执行了 rm -rf /usr 现在系统起不来了",
            "kill -9 杀了进程后服务启动失败",
            "改了 nginx 配置后网站打不开了",
            "数据库迁移跑了一半失败了怎么办",
            "我不小心把 /etc/passwd 覆盖了",
            "服务器起不来了",
            "服务一直报错怎么恢复",
            "磁盘满了导致应用挂了",
        ]
    },
    "vague_request": {
        "positive_examples": [
            "nginx",
            "Docker",
            "Python",
            "数据库",
            "帮我看看",
            "这个怎么用",
            "k8s",
        ]
    },
    "expert_user": {
        "positive_examples": [
            "nginx stream 模块怎么实现 TCP 负载均衡",
            "Redis 集群的槽位重分片原理",
            "epoll 和 select 的区别",
            "Go 的调度器抢占机制",
            "B+树在 MySQL 中的实现细节",
            "Linux 内核的完全公平调度器",
        ]
    },
    "novice_user": {
        "positive_examples": [
            "我是新手，怎么安装 Python",
            "完全不懂 Linux，怎么入门",
            "第一次用 Docker，帮帮我",
            "我不懂代码，能解释一下吗",
            "小白求教，git 怎么用",
        ]
    },
    "task_status_query": {
        "positive_examples": [
            "刚才那个任务完成了吗",
            "任务 abc123 怎么样了",
            "我的重构跑完了吗",
            "进度多少了",
            "查询任务状态",
            "任务执行完了没",
        ]
    },
    "cancel_task": {
        "positive_examples": [
            "取消任务 abc123",
            "别跑了，停掉它",
            "终止刚才那个重构",
            "停止正在执行的任务",
        ]
    },
    "high_risk_automated": {
        "positive_examples": [
            "帮我清理 /tmp 下超过 7 天的文件",
            "批量修改所有 .conf 文件的权限为 644",
            "删除所有 node_modules 目录",
            "递归删除日志文件",
        ]
    },
    "chitchat": {
        "positive_examples": [
            "今天天气怎么样",
            "你好",
            "谢谢",
            "你叫什么名字",
            "讲个笑话",
            "吃饭了吗",
            "周末去哪玩",
            "推荐一部电影",
        ]
    },
}


def generate_training_data():
    data = []
    for label, info in SCENE_DEFINITIONS.items():
        for example in info["positive_examples"]:
            data.append((example, label))
    return data


if __name__ == "__main__":
    data = generate_training_data()
    print(f"生成了 {len(data)} 条训练数据，{len(SCENE_DEFINITIONS)} 个场景")