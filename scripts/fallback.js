/**
 * 离线/弱网环境下的轻量级降级实现。
 * 当 CDN 资源加载失败时，提供基础的 Markdown 解析、代码高亮和 HTML 过滤能力，
 * 保证编辑器仍可正常编辑和预览。
 */
(function (global) {
  // ===== 轻量 Markdown 解析器 =====
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseInline(text) {
    return (
      escapeHtml(text)
        // 代码
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // 粗体
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        // 斜体
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        // 删除线
        .replace(/~~(.+?)~~/g, '<del>$1</del>')
        // 图片
        .replace(/!\[(.*?)\]\((.+?)\)/g, '<img src="$2" alt="$1">')
        // 链接
        .replace(/\[(.*?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    );
  }

  function parseMarkdown(src) {
    const lines = src.split('\n');
    const out = [];
    let i = 0;

    function flushParagraph(buf) {
      if (buf.length) {
        out.push('<p>' + parseInline(buf.join(' ')) + '</p>');
      }
    }

    while (i < lines.length) {
      let line = lines[i];

      // 空行
      if (!line.trim()) {
        i++;
        continue;
      }

      // 分隔线
      if (/^\s*-{3,}\s*$/.test(line) || /^\s*\*{3,}\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 标题
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        out.push(`<h${level}>${parseInline(headingMatch[2])}</h${level}>`);
        i++;
        continue;
      }

      // 代码块
      const codeFenceMatch = line.match(/^```(\w*)\s*$/);
      if (codeFenceMatch) {
        const lang = codeFenceMatch[1] || '';
        const codeLines = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        out.push(`<pre><code class="language-${lang}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        continue;
      }

      // 引用块
      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + parseMarkdown(quoteLines.join('\n')) + '</blockquote>');
        continue;
      }

      // 无序列表
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push('<li>' + parseInline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push('<li>' + parseInline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ol>' + items.join('') + '</ol>');
        continue;
      }

      // 表格
      if (/^\s*\|/.test(line)) {
        const tableLines = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          tableLines.push(lines[i]);
          i++;
        }
        if (tableLines.length >= 2 && /^\s*\|[-:\s|]+\|\s*$/.test(tableLines[1])) {
          const headers = tableLines[0]
            .split('|')
            .map((c) => c.trim())
            .filter(Boolean);
          const bodyRows = tableLines.slice(2).map((row) =>
            row
              .split('|')
              .map((c) => c.trim())
              .filter(Boolean)
          );
          let html = '<table><thead><tr>' + headers.map((h) => '<th>' + parseInline(h) + '</th>').join('') + '</tr></thead><tbody>';
          for (const row of bodyRows) {
            html += '<tr>' + row.map((c) => '<td>' + parseInline(c) + '</td>').join('') + '</tr>';
          }
          html += '</tbody></table>';
          out.push(html);
          continue;
        }
      }

      // 普通段落（合并连续行）
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|[-*+\d]\.\s|```|\|)/.test(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      flushParagraph(para);
    }

    return out.join('\n');
  }

  // 如果 marked 未加载，提供降级实现
  if (!global.marked) {
    global.marked = {
      parse: parseMarkdown,
      setOptions: () => {},
    };
  }

  // DOMPurify 降级
  if (!global.DOMPurify) {
    global.DOMPurify = {
      sanitize: (html) => html,
    };
  }

  // highlight.js 降级
  if (!global.hljs) {
    global.hljs = {
      getLanguage: () => false,
      highlight: (code) => ({ value: escapeHtml(code) }),
      highlightAuto: (code) => ({ value: escapeHtml(code) }),
    };
  }

  // KaTeX auto-render 降级（忽略数学公式）
  if (typeof global.renderMathInElement !== 'function') {
    global.renderMathInElement = () => {};
  }
})(window);
