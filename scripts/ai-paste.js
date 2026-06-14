/**
 * AI Paste Cleaner
 * 处理从 ChatGPT、Claude、Kimi、Gemini 等 AI 对话页面复制的内容，
 * 清洗成干净的 Markdown。
 */
(function (global) {
  const DEFAULT_OPTS = {
    removeCopyButtons: true,
    normalizeHeadings: true,
    convertTables: true,
    fixCodeLang: true,
    mergeLines: true,
  };

  /**
   * 将 HTML 字符串转换为 Markdown（轻量级，主要用于表格、列表、代码块）
   */
  function htmlToMarkdown(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    function walk(node, listPrefix = '') {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }

      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map((n) => walk(n, listPrefix)).join('');

      switch (tag) {
        case 'br':
          return '\n';
        case 'p':
          return '\n\n' + children + '\n\n';
        case 'div':
          return '\n' + children + '\n';
        case 'strong':
        case 'b':
          return '**' + children.trim() + '**';
        case 'em':
        case 'i':
          return '*' + children.trim() + '*';
        case 'code':
          return '`' + children.trim() + '`';
        case 'pre':
          return '\n```\n' + children.replace(/^```|```$/g, '').trim() + '\n```\n';
        case 'a':
          return '[' + children + '](' + (node.getAttribute('href') || '') + ')';
        case 'h1':
          return '\n# ' + children.trim() + '\n';
        case 'h2':
          return '\n## ' + children.trim() + '\n';
        case 'h3':
          return '\n### ' + children.trim() + '\n';
        case 'h4':
          return '\n#### ' + children.trim() + '\n';
        case 'h5':
          return '\n##### ' + children.trim() + '\n';
        case 'h6':
          return '\n###### ' + children.trim() + '\n';
        case 'li':
          if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'ol') {
            return '1. ' + children.trim() + '\n';
          }
          return listPrefix + '- ' + children.trim() + '\n';
        case 'ul':
          return '\n' + children + '\n';
        case 'ol':
          return '\n' + children + '\n';
        case 'table':
          return tableToMarkdown(node);
        case 'blockquote':
          return '\n' + children.trim().split('\n').map((l) => '> ' + l).join('\n') + '\n';
        case 'hr':
          return '\n---\n';
        case 'script':
        case 'style':
        case 'button':
        case 'svg':
          return '';
        default:
          return children;
      }
    }

    return walk(doc.body).trim();
  }

  function tableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';

    const cells = rows.map((row) =>
      Array.from(row.querySelectorAll('td, th')).map((cell) => cell.textContent.trim().replace(/\|/g, '\\|'))
    );

    if (!cells.length || !cells[0].length) return '';

    const widths = cells[0].map((_, i) => Math.max(...cells.map((row) => (row[i] ? row[i].length : 0)), 3));

    function pad(cell, i) {
      return (cell || '').padEnd(widths[i], ' ');
    }

    const header = '| ' + cells[0].map(pad).join(' | ') + ' |';
    const separator = '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
    const body = cells
      .slice(1)
      .map((row) => '| ' + widths.map((_, i) => pad(row[i] || '', i)).join(' | ') + ' |')
      .join('\n');

    return '\n' + [header, separator, body].filter(Boolean).join('\n') + '\n';
  }

  /**
   * 检测文本是否包含大量 HTML
   */
  function containsHtml(text) {
    return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(text) && /<\/\1>/i.test(text);
  }

  /**
   * 移除复制按钮残留（包括文字、图标、aria-label 等）
   */
  function removeCopyArtifacts(text) {
    // 移除常见复制按钮文本：Copy、复制、Copied!、📋 等
    return text
      .replace(/\[?(Copy|复制|Copied!|已复制|📋|📝|✅)\]?\s*$/gim, '')
      .replace(/^\s*Copy\s*$/gim, '')
      .replace(/copy\s+code/gi, '')
      .replace(/```\n\s*Copy\s*\n```/gi, '')
      .replace(/<button[^>]*copy[^>]*>.*?<\/button>/gi, '')
      .replace(/<span[^>]*class="[^"]*copy[^"]*"[^>]*>.*?<\/span>/gi, '');
  }

  /**
   * 规范化标题层级：将连续的 # 或 AI 生成的粗体标题转为 Markdown 标题
   */
  function normalizeHeadings(text) {
    let lines = text.split('\n');
    let result = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // 修复已经带 # 但空格不对的标题
      line = line.replace(/^(#{1,6})\s*(.+)$/, (m, hs, title) => hs + ' ' + title.trim());

      // 将 **标题** 独占一行转换为 h2
      if (/^\*\*[^*]+\*\*$/.test(line) && !lines[i - 1]?.startsWith('#')) {
        line = '## ' + line.replace(/^\*\*|\*\*$/g, '');
      }

      result.push(line);
    }

    return result.join('\n');
  }

  /**
   * 修复代码块语言标识：把 ```plaintext、```text、无语言等处理为更合理的形式
   */
  function fixCodeLanguage(text) {
    return text
      .replace(/```(plaintext|text|txt)\b/gi, '```text')
      .replace(/```\s*\n/g, '```\n')
      .replace(/```\s*([^\n]*?)\s*\n/g, (m, lang) => {
        const cleanLang = lang.toLowerCase().trim();
        const knownLangs = new Set([
          'js', 'javascript', 'ts', 'typescript', 'python', 'py', 'java', 'c', 'cpp', 'c++', 'csharp', 'cs', 'go',
          'rust', 'rs', 'ruby', 'rb', 'php', 'swift', 'kotlin', 'scala', 'r', 'matlab', 'sql', 'bash', 'sh', 'shell',
          'zsh', 'powershell', 'ps1', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'markdown', 'md', 'html',
          'css', 'scss', 'sass', 'less', 'vue', 'react', 'jsx', 'tsx', 'dockerfile', 'makefile', 'cmake', 'lua',
          'perl', 'haskell', 'hs', 'erlang', 'elixir', 'clojure', 'lisp', 'scheme', 'dart', 'flutter', 'julia',
          'groovy', 'kotlin', 'ocaml', 'fsharp', 'fs', 'vb', 'asm', 'nasm', 'mips', 'verilog', 'vhdl', 'latex',
          'tex', 'bibtex', 'diff', 'patch', 'http', 'graphql', 'regex', 'vim', 'nginx', 'apache', 'ini', 'properties',
        ]);
        if (!cleanLang) return '```\n';
        if (knownLangs.has(cleanLang)) return '```' + cleanLang + '\n';
        return '```' + cleanLang + '\n';
      });
  }

  /**
   * 合并错误换行：AI 内容里常把一句长话错误断行
   */
  function mergeBrokenLines(text) {
    const lines = text.split('\n');
    const result = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const prev = result.length ? result[result.length - 1] : '';
      const prevTrimmed = prev.trim();

      // 不合并的情况
      if (
        !trimmed ||
        /^\s*[-*+\d]\s+/.test(trimmed) ||
        /^\s*#{1,6}\s/.test(trimmed) ||
        /^\s*>\s/.test(trimmed) ||
        /^\s*```/.test(trimmed) ||
        /^\s*\|/.test(trimmed) ||
        /^\s*\[/.test(trimmed) ||
        /^\s*!\[/.test(trimmed) ||
        /^---+/.test(trimmed) ||
        /^\s*<details/i.test(trimmed) ||
        /^\s*<summary/i.test(trimmed) ||
        /^\s*<\/details/i.test(trimmed) ||
        /^\s*<\/summary/i.test(trimmed)
      ) {
        result.push(line);
        continue;
      }

      // 上一行是列表、代码块、标题、分隔线等也不合并
      if (
        !prevTrimmed ||
        /^\s*[-*+\d]\s+/.test(prevTrimmed) ||
        /^\s*#{1,6}\s/.test(prevTrimmed) ||
        /^\s*>\s/.test(prevTrimmed) ||
        /^\s*```/.test(prevTrimmed) ||
        /^\s*\|/.test(prevTrimmed) ||
        /^---+/.test(prevTrimmed) ||
        /[。！？.!?~：:""''）]$/.test(prevTrimmed)
      ) {
        result.push(line);
        continue;
      }

      // 合并到上一行
      result[result.length - 1] = prev + ' ' + trimmed;
    }

    return result.join('\n');
  }

  /**
   * 清理多余空行
   */
  function collapseBlankLines(text) {
    return text.replace(/\n{3,}/g, '\n\n');
  }

  /**
   * 转换文本中可能存在的类表格对齐文本为 Markdown 表格
   */
  function convertTextTables(text) {
    // 简单检测：至少两行，每行包含两个以上制表符或连续空格分隔的列
    const lines = text.split('\n');
    const result = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const next = lines[i + 1];

      // 检测可能的表头+分隔符组合
      if (
        next &&
        /^\s*[-\s|]+$/.test(next) &&
        line.includes('|') &&
        next.includes('|')
      ) {
        // 已经是 Markdown 表格
        result.push(line);
        result.push(next);
        i += 2;
        continue;
      }

      // 通过制表符分隔
      if (line.includes('\t') && line.split('\t').length >= 2) {
        const cols = line.split('\t').map((c) => c.trim());
        const nextCols = next ? next.split('\t').map((c) => c.trim()) : [];

        if (nextCols.length === cols.length && nextCols.every((c) => /^[-=]+$/.test(c))) {
          result.push('| ' + cols.join(' | ') + ' |');
          result.push('| ' + cols.map(() => '---').join(' | ') + ' |');
          i += 2;
          continue;
        }
      }

      result.push(line);
      i++;
    }

    return result.join('\n');
  }

  /**
   * 主入口：清洗 AI 粘贴内容
   */
  function cleanAiPaste(input, opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts || {});

    let text = input;

    // 如果粘贴板里带 HTML，先转 Markdown
    if (containsHtml(text)) {
      text = htmlToMarkdown(text);
    }

    if (opts.removeCopyButtons) {
      text = removeCopyArtifacts(text);
    }

    if (opts.normalizeHeadings) {
      text = normalizeHeadings(text);
    }

    if (opts.convertTables) {
      text = convertTextTables(text);
    }

    if (opts.fixCodeLang) {
      text = fixCodeLanguage(text);
    }

    if (opts.mergeLines) {
      text = mergeBrokenLines(text);
    }

    // 确保代码块围栏单独成行（保留语言标识，拆分误连的表格/列表）
    text = text
      .split('\n')
      .reduce((acc, line) => {
        const m = line.match(/^(```+)(\s*)(.*)$/);
        if (!m) {
          acc.push(line);
          return acc;
        }
        const fence = m[1];
        const rest = m[3].trim();
        // 空围栏或带语言标识（单字词）保持原样
        if (!rest || /^[\w+.-]+$/.test(rest)) {
          acc.push(line);
        } else {
          acc.push(fence);
          acc.push(rest);
        }
        return acc;
      }, [])
      .join('\n');

    text = collapseBlankLines(text);

    return text.trim();
  }

  // 暴露到全局
  global.AiPasteCleaner = {
    clean: cleanAiPaste,
    htmlToMarkdown,
  };
})(window);
