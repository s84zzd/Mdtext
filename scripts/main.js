(() => {
  'use strict';

  // ===== 元素引用 =====
  const editor = document.getElementById('editor');
  const preview = document.getElementById('preview');
  const lineNumbers = document.getElementById('line-numbers');
  const outline = document.getElementById('outline');
  const sidebar = document.getElementById('sidebar');
  const fileInput = document.getElementById('file-input');
  const toast = document.getElementById('toast');
  const aiPasteModal = document.getElementById('ai-paste-modal');
  const aiPasteArea = document.getElementById('ai-paste-area');

  // 状态
  const state = {
    content: localStorage.getItem('ai-mark-content') || '# 未命名文档\n\n开始输入或粘贴 Markdown 内容...\n',
    fileName: localStorage.getItem('ai-mark-filename') || '未命名.md',
    fileHandle: null,
    isReading: false,
    isDirty: false,
    theme: localStorage.getItem('ai-mark-theme') || 'light',
    syncScroll: true,
    lastSaved: Date.now(),
  };

  // ===== 初始化 =====
  function init() {
    document.body.setAttribute('data-theme', state.theme);
    updateHljsTheme();

    editor.value = state.content;
    updateStats();
    render();
    updateTitle();

    bindEvents();
    setupMarked();
    updateOutline();

    setInterval(autoSave, 5000);

    if (state.theme === 'dark') {
      document.getElementById('hljs-theme').href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
    }
  }

  function setupMarked() {
    marked.setOptions({
      gfm: true,
      breaks: false,
      tables: true,
      xhtml: false,
      sanitize: false,
      smartLists: true,
      smartypants: false,
      highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (e) {
            // ignore
          }
        }
        return hljs.highlightAuto(code).value;
      },
    });
  }

  // ===== 渲染 =====
  function render() {
    const raw = editor.value;
    let html = marked.parse(raw);

    // 安全过滤（保留代码高亮类名）
    html = DOMPurify.sanitize(html, {
      ADD_TAGS: ['details', 'summary'],
      ADD_ATTR: ['class', 'id', 'data-line'],
    });

    preview.innerHTML = html;

    // 数学公式
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(preview, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    }

    // 为代码块添加复制按钮和语言标签
    enhanceCodeBlocks();

    updateOutline();
    updateStats();
    state.isDirty = true;
  }

  function enhanceCodeBlocks() {
    preview.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code) return;

      // 语言标签
      let lang = '';
      const match = code.className.match(/language-(\w+)/);
      if (match) {
        lang = match[1];
      }

      if (lang && !pre.querySelector('.code-lang')) {
        const langTag = document.createElement('span');
        langTag.className = 'code-lang';
        langTag.textContent = lang;
        pre.appendChild(langTag);
      }

      // 复制按钮
      if (!pre.querySelector('.copy-code')) {
        const btn = document.createElement('button');
        btn.className = 'copy-code';
        btn.textContent = '复制';
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(code.textContent).then(() => {
            btn.textContent = '已复制';
            setTimeout(() => (btn.textContent = '复制'), 1500);
          });
        });
        pre.appendChild(btn);
      }
    });
  }

  // ===== 大纲 =====
  function updateOutline() {
    const headings = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
    outline.innerHTML = '';

    headings.forEach((h, idx) => {
      const level = parseInt(h.tagName[1], 10);
      const a = document.createElement('a');
      a.className = `outline-item level-${level}`;
      a.textContent = h.textContent;
      a.href = '#';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (state.isReading) return;
        // 同步滚动编辑器
        scrollEditorToHeading(idx);
      });
      outline.appendChild(a);
    });
  }

  function scrollEditorToHeading(idx) {
    const source = editor.value;
    const regex = /^(#{1,6})\s+(.+)$/gm;
    let match;
    let count = 0;
    let targetPos = 0;
    while ((match = regex.exec(source)) !== null) {
      if (count === idx) {
        targetPos = match.index;
        break;
      }
      count++;
    }

    const lines = source.substring(0, targetPos).split('\n');
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
    editor.scrollTop = Math.max(0, (lines.length - 1) * lineHeight - editor.clientHeight / 3);
  }

  // ===== 行号 =====
  function updateLineNumbers() {
    const lines = editor.value.split('\n').length;
    lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => i + 1).join('<br>');
  }

  function syncLineScroll() {
    lineNumbers.scrollTop = editor.scrollTop;
  }

  // ===== 统计 =====
  function updateStats() {
    const text = editor.value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    // 中文按字，英文按词粗略估算 token
    const tokens = Math.ceil(words * 1.3 + (text.match(/[\u4e00-\u9fa5]/g) || []).length * 0.6);

    document.getElementById('stat-words').textContent = `${words} 词`;
    document.getElementById('stat-chars').textContent = `${chars} 字`;
    document.getElementById('stat-tokens').textContent = `~${tokens} tokens`;
  }

  // ===== 同步滚动 =====
  function syncPreviewScroll() {
    if (!state.syncScroll || state.isReading) return;
    const ratio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
    preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
  }

  function syncEditorScroll() {
    if (!state.syncScroll || state.isReading) return;
    const ratio = preview.scrollTop / (preview.scrollHeight - preview.clientHeight || 1);
    editor.scrollTop = ratio * (editor.scrollHeight - editor.clientHeight);
  }

  // ===== 工具栏命令 =====
  function insertText(before, after = '', placeholder = '') {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;
    const selected = value.substring(start, end) || placeholder;

    const replacement = before + selected + after;
    editor.value = value.substring(0, start) + replacement + value.substring(end);

    const cursorPos = start + before.length + selected.length;
    if (selected === placeholder) {
      editor.setSelectionRange(start + before.length, cursorPos);
    } else {
      editor.setSelectionRange(cursorPos, cursorPos);
    }

    editor.focus();
    render();
  }

  function insertBlock(prefix, suffix = '') {
    const start = editor.selectionStart;
    const value = editor.value;
    const before = value.lastIndexOf('\n', start - 1) + 1;
    const after = value.indexOf('\n', start);
    const lineEnd = after === -1 ? value.length : after;

    const currentLine = value.substring(before, lineEnd);
    const newLine = prefix + currentLine + suffix;
    editor.value = value.substring(0, before) + newLine + value.substring(lineEnd);
    editor.setSelectionRange(before + newLine.length, before + newLine.length);
    editor.focus();
    render();
  }

  const commands = {
    bold: () => insertText('**', '**', '加粗文本'),
    italic: () => insertText('*', '*', '斜体文本'),
    strike: () => insertText('~~', '~~', '删除线'),
    code: () => insertText('`', '`', 'code'),
    link: () => insertText('[', '](https://example.com)', '链接文本'),
    image: () => insertText('![', '](https://example.com/image.png)', '图片描述'),
    quote: () => insertBlock('> '),
    ul: () => insertBlock('- '),
    ol: () => insertBlock('1. '),
    task: () => insertBlock('- [ ] '),
    hr: () => insertText('\n---\n'),
    table: () => {
      const table =
        '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n';
      insertText(table);
    },
  };

  // ===== 文件操作 =====
  async function newFile() {
    if (state.isDirty && editor.value !== localStorage.getItem('ai-mark-content')) {
      const ok = confirm('当前文档有未保存的更改，是否放弃？');
      if (!ok) return;
    }
    state.content = '# 未命名文档\n\n';
    editor.value = state.content;
    state.fileName = '未命名.md';
    state.fileHandle = null;
    state.isDirty = false;
    updateTitle();
    render();
    showToast('新建文档');
  }

  async function openFile() {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await window.showOpenFilePicker({
          types: [
            {
              description: 'Markdown 文件',
              accept: { 'text/markdown': ['.md', '.markdown', '.txt', '.text'] },
            },
          ],
        });
        const file = await handle.getFile();
        const text = await file.text();
        state.fileHandle = handle;
        state.fileName = file.name;
        state.content = text;
        editor.value = text;
        render();
        updateTitle();
        showToast(`已打开 ${file.name}`);
      } else {
        fileInput.click();
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        showToast('打开失败：' + err.message);
      }
    }
  }

  async function saveFile() {
    try {
      if ('showSaveFilePicker' in window && !state.fileHandle) {
        state.fileHandle = await window.showSaveFilePicker({
          suggestedName: state.fileName.endsWith('.md') ? state.fileName : state.fileName + '.md',
          types: [
            {
              description: 'Markdown 文件',
              accept: { 'text/markdown': ['.md', '.markdown'] },
            },
          ],
        });
      }

      if (state.fileHandle) {
        const writable = await state.fileHandle.createWritable();
        await writable.write(editor.value);
        await writable.close();
        state.fileName = state.fileHandle.name;
      } else {
        downloadFile(editor.value, state.fileName, 'text/markdown');
      }

      state.isDirty = false;
      state.lastSaved = Date.now();
      updateTitle();
      showToast(`已保存 ${state.fileName}`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        downloadFile(editor.value, state.fileName, 'text/markdown');
      }
    }
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleFileInput(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.content = reader.result;
      editor.value = reader.result;
      state.fileName = file.name;
      state.fileHandle = null;
      render();
      updateTitle();
      showToast(`已打开 ${file.name}`);
    };
    reader.readAsText(file);
  }

  function updateTitle() {
    document.title = `${state.isDirty ? '• ' : ''}${state.fileName} — AI Mark`;
    document.getElementById('status-file').textContent = state.fileName;
    document.getElementById('status-saved').textContent = state.isDirty ? '未保存' : '已自动保存';
  }

  function autoSave() {
    if (!state.isDirty) return;
    localStorage.setItem('ai-mark-content', editor.value);
    localStorage.setItem('ai-mark-filename', state.fileName);
    state.isDirty = false;
    state.lastSaved = Date.now();
    document.getElementById('status-saved').textContent = '已自动保存';
    updateTitle();
  }

  // ===== AI 粘贴 =====
  function openAiPasteModal() {
    aiPasteModal.classList.add('show');
    aiPasteArea.value = '';
    setTimeout(() => aiPasteArea.focus(), 50);
  }

  function closeAiPasteModal() {
    aiPasteModal.classList.remove('show');
  }

  function confirmAiPaste() {
    const raw = aiPasteArea.value;
    if (!raw.trim()) {
      closeAiPasteModal();
      return;
    }

    const opts = {
      removeCopyButtons: document.getElementById('opt-remove-copy-btns').checked,
      normalizeHeadings: document.getElementById('opt-normalize-headings').checked,
      convertTables: document.getElementById('opt-convert-tables').checked,
      fixCodeLang: document.getElementById('opt-fix-code-lang').checked,
      mergeLines: document.getElementById('opt-merge-lines').checked,
    };

    const cleaned = window.AiPasteCleaner.clean(raw, opts);
    insertText(cleaned + '\n\n');
    closeAiPasteModal();
    showToast('AI 内容已插入并清洗');
  }

  function cleanCurrentDocument() {
    const cleaned = window.AiPasteCleaner.clean(editor.value, {
      removeCopyButtons: true,
      normalizeHeadings: true,
      convertTables: true,
      fixCodeLang: true,
      mergeLines: true,
    });
    editor.value = cleaned;
    render();
    showToast('文档已清洗');
  }

  // ===== 主题与阅读模式 =====
  function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', state.theme);
    localStorage.setItem('ai-mark-theme', state.theme);
    updateHljsTheme();
  }

  function updateHljsTheme() {
    const link = document.getElementById('hljs-theme');
    if (state.theme === 'dark') {
      link.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
    } else {
      link.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css';
    }
  }

  function toggleReadingMode() {
    state.isReading = !state.isReading;
    document.body.classList.toggle('reading-mode', state.isReading);
    document.getElementById('btn-reading').classList.toggle('active', state.isReading);
    document.getElementById('status-mode').textContent = state.isReading ? '阅读模式' : '编辑模式';

    if (!state.isReading) {
      render();
    }
  }

  // ===== 导出 =====
  function exportMarkdown() {
    downloadFile(editor.value, state.fileName.replace(/\.html?$/i, '.md') || '导出.md', 'text/markdown');
    showToast('已导出 Markdown');
  }

  function exportHtml() {
    const htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${state.fileName}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<style>
  body { max-width: 860px; margin: 40px auto; padding: 0 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.75; color: #24292e; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
  code { font-family: SFMono-Regular, Consolas, monospace; font-size: 0.9em; }
  blockquote { border-left: 4px solid #2563eb; padding-left: 16px; margin-left: 0; color: #586069; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #dfe2e5; padding: 8px 12px; }
  th { background: #f6f8fa; }
  img { max-width: 100%; }
</style>
</head>
<body>
${preview.innerHTML}
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"><\/script>
<script>
  document.addEventListener("DOMContentLoaded", function() {
    renderMathInElement(document.body, { delimiters: [{left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false}] });
  });
<\/script>
</body>
</html>`;
    const name = state.fileName.replace(/\.md$/i, '.html') || '导出.html';
    downloadFile(htmlContent, name, 'text/html');
    showToast('已导出 HTML');
  }

  // ===== AI API 功能 =====
  const aiPanel = document.getElementById('ai-panel');
  const aiPanelBody = document.getElementById('ai-panel-body');
  const aiPanelTitle = document.getElementById('ai-panel-title');
  const aiPanelStatus = document.getElementById('ai-panel-status');
  const aiConfigModal = document.getElementById('ai-config-modal');
  let aiAbortController = null;
  let aiResultText = '';

  function openAiPanel() {
    aiPanel.classList.add('show');
  }

  function closeAiPanel() {
    aiPanel.classList.remove('show');
  }

  function setAiPanelEmpty() {
    aiPanelBody.innerHTML = '<div class="ai-panel-empty">选择一段文字并点击工具栏的 AI 功能，即可调用大模型进行续写、润色、总结等操作。</div>';
    aiPanelBody.classList.remove('streaming');
    aiResultText = '';
  }

  function openAiConfigModal() {
    const config = AiApi.getConfig();
    const presets = AiApi.getPresets();

    document.getElementById('ai-base-url').value = config.baseUrl;
    document.getElementById('ai-api-key').value = config.apiKey;
    document.getElementById('ai-model').value = config.model;
    document.getElementById('ai-temperature').value = config.temperature;
    document.getElementById('ai-max-tokens').value = config.maxTokens;
    document.getElementById('ai-stream').checked = config.stream;

    // 根据 baseUrl 反选 preset
    let provider = 'custom';
    for (const key of Object.keys(presets)) {
      if (key !== 'custom' && config.baseUrl === presets[key].baseUrl) {
        provider = key;
        break;
      }
    }
    document.getElementById('ai-provider').value = provider;
    updateModelDatalist(provider);

    aiConfigModal.classList.add('show');
  }

  function closeAiConfigModal() {
    aiConfigModal.classList.remove('show');
  }

  function updateModelDatalist(provider) {
    const presets = AiApi.getPresets();
    const list = document.getElementById('ai-model-list');
    list.innerHTML = '';
    const models = presets[provider]?.models || [];
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m;
      list.appendChild(opt);
    }
  }

  function saveAiConfig() {
    const config = {
      baseUrl: document.getElementById('ai-base-url').value.trim(),
      apiKey: document.getElementById('ai-api-key').value.trim(),
      model: document.getElementById('ai-model').value.trim(),
      temperature: parseFloat(document.getElementById('ai-temperature').value) || 0.6,
      maxTokens: parseInt(document.getElementById('ai-max-tokens').value, 10) || 4096,
      stream: document.getElementById('ai-stream').checked,
    };
    AiApi.saveConfig(config);
    closeAiConfigModal();
    showToast('API 设置已保存');
  }

  async function runAiAction(promptKey) {
    const prompts = AiApi.getPrompts();
    const prompt = prompts[promptKey];
    if (!prompt) return;

    const config = AiApi.getConfig();
    if (!config.apiKey) {
      showToast('请先配置 API Key');
      openAiConfigModal();
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.substring(start, end).trim();

    let textToProcess = selected;
    let insertMode = 'replace'; // replace or append

    if (!selected) {
      // 未选中时使用光标所在段落或全文
      const value = editor.value;
      const paraStart = value.lastIndexOf('\n\n', start) + 2;
      const paraEnd = value.indexOf('\n\n', start);
      const paragraph = value.substring(paraStart === 1 ? 0 : paraStart, paraEnd === -1 ? value.length : paraEnd).trim();
      if (paragraph) {
        textToProcess = paragraph;
        insertMode = 'append';
      } else {
        textToProcess = value;
        insertMode = 'append';
      }
    }

    if (!textToProcess) {
      showToast('没有可处理的内容');
      return;
    }

    openAiPanel();
    aiPanelTitle.textContent = `${prompt.icon} ${prompt.label}`;
    aiPanelBody.innerHTML = '';
    aiPanelBody.classList.add('streaming');
    aiPanelStatus.textContent = '生成中...';
    aiResultText = '';
    document.getElementById('btn-ai-panel-cancel').style.display = 'inline-block';
    setAiButtonsDisabled(true);

    aiAbortController = new AbortController();

    try {
      await AiApi.run(promptKey, textToProcess, {
        onChunk: (chunk, done) => {
          if (done) {
            aiPanelBody.classList.remove('streaming');
            aiPanelStatus.textContent = '完成';
            document.getElementById('btn-ai-panel-cancel').style.display = 'none';
            setAiButtonsDisabled(false);
            return;
          }
          aiResultText += chunk;
          aiPanelBody.textContent = aiResultText;
          aiPanelBody.scrollTop = aiPanelBody.scrollHeight;
        },
        signal: aiAbortController.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        aiPanelStatus.textContent = '已停止';
      } else {
        aiPanelStatus.textContent = '失败';
        aiPanelBody.textContent = `错误：${err.message}\n\n提示：如果浏览器提示 CORS 错误，可尝试通过本地代理或浏览器扩展绕过。`;
      }
      aiPanelBody.classList.remove('streaming');
      document.getElementById('btn-ai-panel-cancel').style.display = 'none';
      setAiButtonsDisabled(false);
    } finally {
      aiAbortController = null;
    }
  }

  function stopAi() {
    if (aiAbortController) {
      aiAbortController.abort();
    }
  }

  function insertAiResult() {
    if (!aiResultText) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;
    const selected = value.substring(start, end);

    if (selected) {
      editor.value = value.substring(0, start) + aiResultText + value.substring(end);
      editor.setSelectionRange(start + aiResultText.length, start + aiResultText.length);
    } else {
      // 在光标处插入，并前后留空行
      const prefix = value.substring(0, start);
      const suffix = value.substring(start);
      const spacer = prefix.endsWith('\n') || prefix === '' ? '' : '\n';
      const insert = spacer + '\n' + aiResultText.trim() + '\n\n';
      editor.value = prefix + insert + suffix;
      editor.setSelectionRange(prefix.length + insert.length, prefix.length + insert.length);
    }

    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
    showToast('已插入到编辑器');
  }

  function copyAiResult() {
    if (!aiResultText) return;
    navigator.clipboard.writeText(aiResultText).then(() => {
      showToast('已复制');
    });
  }

  function setAiButtonsDisabled(disabled) {
    document.querySelectorAll('.ai-action').forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  // ===== 提示 =====
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 编辑输入
    let renderTimer;
    editor.addEventListener('input', () => {
      updateLineNumbers();
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 150);
      state.isDirty = true;
      updateTitle();
    });

    editor.addEventListener('scroll', () => {
      syncLineScroll();
      syncPreviewScroll();
    });

    preview.addEventListener('scroll', syncEditorScroll);

    // Tab 键插入两个空格
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        insertText('  ');
      }
    });

    // 行号初始化
    updateLineNumbers();

    // 工具栏命令
    document.querySelectorAll('[data-cmd]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmd = btn.getAttribute('data-cmd');
        if (commands[cmd]) commands[cmd]();
      });
    });

    // 顶部按钮
    document.getElementById('btn-new').addEventListener('click', newFile);
    document.getElementById('btn-open').addEventListener('click', openFile);
    document.getElementById('btn-save').addEventListener('click', saveFile);
    document.getElementById('btn-ai-paste').addEventListener('click', openAiPasteModal);
    document.getElementById('btn-clean').addEventListener('click', cleanCurrentDocument);
    document.getElementById('btn-reading').addEventListener('click', toggleReadingMode);
    document.getElementById('btn-ai-config').addEventListener('click', openAiConfigModal);
    document.getElementById('btn-theme').addEventListener('click', toggleTheme);
    document.getElementById('btn-export-md').addEventListener('click', exportMarkdown);
    document.getElementById('btn-export-html').addEventListener('click', exportHtml);

    // AI 动作按钮
    document.querySelectorAll('.ai-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-ai');
        runAiAction(key);
      });
    });

    // AI 输出面板
    document.getElementById('btn-ai-panel-close').addEventListener('click', closeAiPanel);
    document.getElementById('btn-ai-panel-copy').addEventListener('click', copyAiResult);
    document.getElementById('btn-ai-panel-insert').addEventListener('click', insertAiResult);
    document.getElementById('btn-ai-panel-cancel').addEventListener('click', stopAi);

    // AI 配置弹窗
    document.getElementById('btn-close-ai-config').addEventListener('click', closeAiConfigModal);
    document.getElementById('btn-ai-config-cancel').addEventListener('click', closeAiConfigModal);
    document.getElementById('btn-ai-config-save').addEventListener('click', saveAiConfig);
    aiConfigModal.addEventListener('click', (e) => {
      if (e.target === aiConfigModal) closeAiConfigModal();
    });
    document.getElementById('ai-provider').addEventListener('change', (e) => {
      const provider = e.target.value;
      const presets = AiApi.getPresets();
      const preset = presets[provider];
      if (preset) {
        document.getElementById('ai-base-url').value = preset.baseUrl;
        if (preset.models.length) {
          document.getElementById('ai-model').value = preset.models[0];
        }
      }
      updateModelDatalist(provider);
    });

    // 文件输入
    fileInput.addEventListener('change', handleFileInput);

    // AI 粘贴弹窗
    document.getElementById('btn-close-ai-paste').addEventListener('click', closeAiPasteModal);
    document.getElementById('btn-ai-paste-cancel').addEventListener('click', closeAiPasteModal);
    document.getElementById('btn-ai-paste-confirm').addEventListener('click', confirmAiPaste);
    aiPasteModal.addEventListener('click', (e) => {
      if (e.target === aiPasteModal) closeAiPasteModal();
    });

    // 侧边栏折叠
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
    });

    // 同步滚动开关
    document.getElementById('btn-sync-scroll').addEventListener('click', () => {
      state.syncScroll = !state.syncScroll;
      document.getElementById('btn-sync-scroll').textContent = state.syncScroll ? '🔒' : '🔓';
      showToast(state.syncScroll ? '同步滚动已开启' : '同步滚动已关闭');
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        openAiPasteModal();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        toggleReadingMode();
      }
    });

    // 监听全局粘贴事件，普通粘贴直接保留原样
    document.addEventListener('paste', (e) => {
      if (aiPasteModal.classList.contains('show')) return;
      // 普通粘贴不做处理，由浏览器默认行为完成
    });
  }

  // 启动
  init();
})();
