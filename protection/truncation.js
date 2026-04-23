/**
 * OpenClaw 保护层 - 输出截断与存储
 * 
 * 功能：
 * - 限制任务输出大小（默认10KB）
 * - 超出阈值自动转存文件
 * - 保留最后1KB显示
 * - UTF-8 字符边界保护
 * - 24小时后自动清理
 * 
 * 配置：
 * - OPENCLAW_MAX_OUTPUT_KB: 最大输出KB数（默认10）
 * - OPENCLAW_OUTPUT_DIR: 输出目录（默认 /tmp/openclaw）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

class OutputTruncation {
  constructor() {
    this.maxSizeKB = parseInt(process.env.OPENCLAW_MAX_OUTPUT_KB || '10');
    this.outputDir = process.env.OPENCLAW_OUTPUT_DIR || '/tmp/openclaw';
    this.ensureDir();
  }

  /**
   * 确保输出目录存在
   */
  ensureDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 创建输出处理器
   * @param {string} taskId - 任务ID
   * @returns {Object} 输出处理器
   */
  createHandler(taskId) {
    const self = this;
    const maxBytes = this.maxSizeKB * 1024;
    let buffer = '';
    let totalBytes = 0;
    let overflow = false;
    let tempFilePath = null;
    let tempFile = null;
    let tailBuffer = '';

    return {
      /**
       * 处理一行输出
       * @param {string} line - 输出行
       * @returns {string|null} 要显示的内容，null表示被截断
       */
      write(line) {
        const lineBytes = Buffer.byteLength(line, 'utf8');
        totalBytes += lineBytes;

        if (!overflow && totalBytes <= maxBytes) {
          buffer += line;
          return line; // 正常显示
        }

        if (!overflow) {
          overflow = true;
          
          // 计算保留的最后1KB
          const tailSize = Math.min(1024, buffer.length);
          const bufferBytes = Buffer.byteLength(buffer, 'utf8');
          let tailStart = 0;
          
          // 找到合适的字符边界
          if (bufferBytes > 1024) {
            const targetBytes = bufferBytes - 1024;
            let currentBytes = 0;
            for (let i = 0; i < buffer.length; i++) {
              currentBytes += Buffer.byteLength(buffer[i], 'utf8');
              if (currentBytes >= targetBytes) {
                tailStart = i;
                break;
              }
            }
          }
          
          tailBuffer = buffer.slice(tailStart);
          
          // 创建临时文件
          const filename = `task_${taskId}_${Date.now()}.out`;
          tempFilePath = path.join(self.outputDir, filename);
          
          try {
            tempFile = fs.createWriteStream(tempFilePath, { flags: 'w', encoding: 'utf8' });
            tempFile.write(buffer);
            tempFile.write('\n[... 输出已截断，完整内容见底部 ...]\n');
          } catch (err) {
            console.warn('[截断] 写入临时文件失败:', err.message);
            tempFilePath = null;
          }
        }

        // 写入临时文件
        if (tempFile) {
          try {
            tempFile.write(line);
          } catch (err) {
            console.warn('[截断] 后续写入失败:', err.message);
          }
        }

        return null; // 不在终端显示
      },

      /**
       * 获取处理结果
       */
      getResult() {
        if (tempFile) {
          tempFile.end();
        }
        
        return {
          truncated: overflow,
          totalBytes,
          maxBytes,
          tempFilePath,
          tailContent: tailBuffer
        };
      },

      /**
       * 关闭处理器
       */
      close() {
        if (tempFile) {
          tempFile.end();
        }
        // 安排24小时后删除
        if (tempFilePath) {
          setTimeout(() => {
            try {
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
              }
            } catch (err) {
              console.warn('[截断] 删除临时文件失败:', err.message);
            }
          }, 24 * 60 * 60 * 1000);
        }
      }
    };
  }

  /**
   * 创建流式处理器（适用于大输出）
   * @param {string} taskId - 任务ID
   * @param {WritableStream} outputStream - 输出流
   * @returns {TransformStream} 转换流
   */
  createStreamHandler(taskId, outputStream) {
    const handler = this.createHandler(taskId);
    
    return new TransformStream({
      transform(chunk, encoding, callback) {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          const display = handler.write(line + '\n');
          if (display) {
            outputStream.write(display);
          }
        }
        callback();
      },
      flush(callback) {
        const result = handler.getResult();
        if (result.truncated) {
          outputStream.write(`\n\n[提示] 完整输出已保存至 ${result.tempFilePath}\n`);
          outputStream.write(`最后1KB内容:\n${result.tailContent}\n`);
        }
        handler.close();
        callback();
      }
    });
  }

  /**
   * 获取输出目录状态
   */
  getStatus() {
    try {
      const files = fs.readdirSync(this.outputDir);
      let totalSize = 0;
      for (const file of files) {
        const stats = fs.statSync(path.join(this.outputDir, file));
        totalSize += stats.size;
      }
      return {
        dir: this.outputDir,
        fileCount: files.length,
        totalSizeKB: Math.round(totalSize / 1024)
      };
    } catch (err) {
      return { error: err.message };
    }
  }
}

// 导出单例
export const outputTruncation = new OutputTruncation();

export default outputTruncation;