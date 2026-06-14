/**
 * AI API 客户端
 * 支持 OpenAI 兼容接口，默认适配 Kimi（Moonshot），也可用于 DeepSeek、Qwen 等。
 */
(function (global) {
  const DEFAULT_CONFIG = {
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    model: 'kimi-k2-6',
    temperature: 0.6,
    maxTokens: 4096,
    stream: true,
  };

  const STORAGE_KEY = 'ai-mark-api-config';

  const PRESETS = {
    kimi: {
      name: 'Kimi（Moonshot）',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['kimi-k2-6', 'kimi-latest', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    },
    deepseek: {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    qwen: {
      name: '通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    },
    openai: {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    },
    custom: {
      name: '自定义',
      baseUrl: '',
      models: [],
    },
  };

  const PROMPTS = {
    continue: {
      label: '续写',
      icon: '✍️',
      system:
        '你是一名专业的技术编辑。请根据用户提供的上下文，继续撰写内容，保持原文风格、格式和语言。只输出续写内容，不要重复已有内容。',
      userPrefix: '请根据以下内容续写：\n\n',
    },
    polish: {
      label: '润色',
      icon: '✨',
      system:
        '你是一名专业的文字润色专家。请在不改变原意的前提下，优化用户提供的文字，使其表达更流畅、专业。保留 Markdown 格式。只输出润色后的内容。',
      userPrefix: '请润色以下内容：\n\n',
    },
    summarize: {
      label: '总结',
      icon: '📋',
      system:
        '你是一名擅长信息提炼的助手。请将用户提供的文章内容整理成结构清晰的摘要，使用 Markdown 列表和标题。保留关键数据、人名、技术名词。',
      userPrefix: '请总结以下内容：\n\n',
    },
    translate: {
      label: '翻译',
      icon: '🌐',
      system:
        '你是一名专业翻译。请将用户提供的文本翻译成目标语言，保持 Markdown 格式和原文结构。只输出翻译结果。',
      userPrefix: '请将以下中文翻译成英文：\n\n',
    },
    fix: {
      label: '纠错',
      icon: '🔧',
      system:
        '你是一名严谨的校对编辑。请检查用户提供的 Markdown 文本，修正其中的错别字、语法错误、格式错误，并保持 Markdown 结构。只输出修正后的内容。',
      userPrefix: '请修正以下内容：\n\n',
    },
    format: {
      label: '格式化',
      icon: '📐',
      system:
        '你是一名 Markdown 格式化专家。请将用户提供的内容整理为规范的 Markdown 格式：统一标题层级、规范列表、整理表格、代码块添加语言标识。只输出格式化后的 Markdown。',
      userPrefix: '请格式化以下内容：\n\n',
    },
    ask: {
      label: '问答',
      icon: '💬',
      system:
        '你是一名知识渊博的 AI 助手。请基于用户的提问给出简洁、准确、结构清晰的回答，使用 Markdown 格式。',
      userPrefix: '',
    },
  };

  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
      }
    } catch (e) {
      console.error('加载 API 配置失败', e);
    }
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  function getConfig() {
    return loadConfig();
  }

  function getPrompts() {
    return PROMPTS;
  }

  function getPresets() {
    return PRESETS;
  }

  /**
   * 构建请求体
   */
  function buildBody(promptKey, text, options = {}) {
    const config = loadConfig();
    const prompt = PROMPTS[promptKey] || PROMPTS.ask;
    const userContent = prompt.userPrefix + text + (options.extra || '');

    return {
      model: config.model,
      messages: [
        { role: 'system', content: options.system || prompt.system },
        { role: 'user', content: userContent },
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: config.stream,
    };
  }

  /**
   * 发送非流式请求
   */
  async function chat(promptKey, text, options = {}) {
    const config = loadConfig();
    if (!config.apiKey) {
      throw new Error('请先配置 API Key');
    }

    const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const body = buildBody(promptKey, text, Object.assign({}, options, { stream: false }));

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API 请求失败 (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * 发送流式请求
   * onChunk: (text, done) => void
   */
  async function streamChat(promptKey, text, options = {}) {
    const config = loadConfig();
    if (!config.apiKey) {
      throw new Error('请先配置 API Key');
    }

    const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const body = buildBody(promptKey, text, options);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`API 请求失败 (${res.status}): ${errText}`);
    }

    if (!res.body) {
      throw new Error('当前环境不支持流式响应');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data:')) continue;

        try {
          const json = JSON.parse(trimmed.replace(/^data:\s*/, ''));
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            if (typeof options.onChunk === 'function') {
              options.onChunk(delta, false);
            }
          }
        } catch (e) {
          // ignore parse error
        }
      }
    }

    if (typeof options.onChunk === 'function') {
      options.onChunk('', true);
    }

    return fullText;
  }

  /**
   * 根据配置选择流式或非流式
   */
  async function run(promptKey, text, options = {}) {
    const config = loadConfig();
    if (config.stream) {
      return streamChat(promptKey, text, options);
    }
    const result = await chat(promptKey, text, options);
    if (typeof options.onChunk === 'function') {
      options.onChunk(result, false);
      options.onChunk('', true);
    }
    return result;
  }

  global.AiApi = {
    DEFAULT_CONFIG,
    PRESETS,
    PROMPTS,
    loadConfig,
    saveConfig,
    getConfig,
    getPrompts,
    getPresets,
    chat,
    streamChat,
    run,
  };
})(window);
