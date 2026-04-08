console.log('HEMA.AI Assistant content script loaded');

interface QuizContext {
  question: string;
  options: string[];
  questionElement: HTMLElement | null;
  optionElements: HTMLElement[];
}

// Visual indicator for scanning
function createVisualOverlay(message: string) {
  let overlay = document.getElementById('hema-ai-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'hema-ai-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: rgba(15, 23, 42, 0.9);
      color: #818cf8;
      border: 1px solid rgba(129, 140, 248, 0.4);
      border-radius: 12px;
      font-family: 'Inter', sans-serif;
      font-size: 14px;
      font-weight: 600;
      z-index: 999999;
      box-shadow: 0 10px 25px rgba(0,0,0,0.3);
      backdrop-filter: blur(8px);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 10px;
    `;
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="hema-spinner"></div> <span>${message}</span>`;

  // Basic spinner style
  if (!document.getElementById('hema-ai-styles')) {
    const style = document.createElement('style');
    style.id = 'hema-ai-styles';
    style.innerHTML = `
      @keyframes hema-spin { to { transform: rotate(360deg); } }
      .hema-spinner { 
        width: 14px; height: 14px; 
        border: 2px solid rgba(129, 140, 248, 0.2); 
        border-top-color: #818cf8; 
        border-radius: 50%; 
        animation: hema-spin 0.8s linear infinite; 
      }
      .hema-highlight-question { outline: 2px solid #818cf8 !important; outline-offset: 4px; border-radius: 4px; transition: outline 0.3s; }
      .hema-highlight-option { outline: 2px solid #10b981 !important; outline-offset: 2px; border-radius: 4px; background: rgba(16, 185, 129, 0.1) !important; }
    `;
    document.head.appendChild(style);
  }
}

function removeOverlay(delay = 2000) {
  const overlay = document.getElementById('hema-ai-overlay');
  if (overlay) {
    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.transform = 'translateY(-10px)';
      setTimeout(() => overlay.remove(), 300);
    }, delay);
  }
}

async function scrapeDetailedQuizData(): Promise<QuizContext | null> {
  // 1. Find potential question
  const questionSelectors = [
    '.question-text', '.problem-container', '.qtext', '[role="main"] h2',
    '.quiz-question h3', '.css-question', 'h2', 'h3'
  ];

  let questionElement: HTMLElement | null = null;
  let questionText = '';

  for (const selector of questionSelectors) {
    const el = document.querySelector(selector) as HTMLElement;
    if (el && el.innerText.trim().length > 10) {
      questionElement = el;
      questionText = el.innerText.trim();
      break;
    }
  }

  // Fallback to searching all text for something ending in ?
  if (!questionText) {
    const allText = Array.from(document.querySelectorAll('p, div, span'))
      .filter(el => el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
      .map(el => (el as HTMLElement).innerText.trim())
      .filter(t => t.length > 20 && t.includes('?'));
    if (allText.length > 0) questionText = allText[0];
  }

  // 2. Find potential options
  const optionSelectors = [
    'label', '.option', '.choice', '.answer', '[role="radio"]', '[role="checkbox"]', 'button'
  ];

  const optionElements: HTMLElement[] = [];
  const optionsText: string[] = [];

  // Look for options near the question if we found a question element
  const searchRoot = questionElement?.parentElement || document.body;

  for (const selector of optionSelectors) {
    const els = Array.from(searchRoot.querySelectorAll(selector)) as HTMLElement[];
    els.forEach(el => {
      const text = el.innerText.trim();
      if (text && text.length > 0 && !optionsText.includes(text) && text !== questionText) {
        // Filter out obviously non-option buttons like "Next", "Submit"
        if (!/next|submit|previous|back|continue|skip/i.test(text)) {
          optionElements.push(el);
          optionsText.push(text);
        }
      }
    });
    if (optionsText.length >= 2) break; // Found some options
  }

  if (!questionText) return null;

  return {
    question: questionText,
    options: optionsText,
    questionElement,
    optionElements
  };
}

async function solveQuiz(model: string, autoAdvance: boolean) {
  createVisualOverlay('Scanning page...');
  const data = await scrapeDetailedQuizData();

  if (!data || !data.question) {
    removeOverlay(0);
    return { success: false, message: 'Could not detect question' };
  }

  // Highlight question
  data.questionElement?.classList.add('hema-highlight-question');

  createVisualOverlay(`Consulting ${model}...`);

  const prompt = `You are an expert quiz solver. 
Question: ${data.question}
Options:
${data.options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

Identify the correct answer. 
Respond ONLY with the exact text of the correct option. No explanation, no labels like "Answer:", just the raw text.`;

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'askOllama',
      prompt,
      model
    });

    if (result.success) {
      const answer = result.response.trim();
      createVisualOverlay(`Answer found: ${answer.substring(0, 20)}...`);

      // Find the best matching option element
      let bestMatch: HTMLElement | null = null;
      let highestScore = 0;

      data.optionElements.forEach(el => {
        const text = el.innerText.trim();
        // Simple fuzzy match
        if (text.toLowerCase().includes(answer.toLowerCase()) ||
          answer.toLowerCase().includes(text.toLowerCase())) {
          const score = Math.abs(text.length - answer.length);
          if (!bestMatch || score < highestScore) {
            bestMatch = el;
            highestScore = score;
          }
        }
      });

      if (bestMatch) {
        (bestMatch as HTMLElement).classList.add('hema-highlight-option');
        (bestMatch as HTMLElement).click();

        // Some platforms need clicking the input inside the label
        const input = (bestMatch as HTMLElement).querySelector('input');
        if (input) input.click();

        if (autoAdvance) {
          createVisualOverlay('Advancing to next...');
          setTimeout(() => {
            const nextBtn = Array.from(document.querySelectorAll('button, a'))
              .find(el => /next|submit|continue|check/i.test((el as HTMLElement).innerText)) as HTMLElement;
            if (nextBtn) nextBtn.click();
          }, 1500);
        }

        removeOverlay(3000);
        return { success: true, answer };
      } else {
        removeOverlay(3000);
        return { success: false, message: `Ollama suggested "${answer}", but I couldn't find a matching element.` };
      }
    } else {
      removeOverlay(3000);
      return { success: false, error: result.error };
    }
  } catch (error) {
    removeOverlay(3000);
    return { success: false, error: 'Extension bridge broken' };
  }
}

async function startCourseAutomation() {
  createVisualOverlay('📡 URL Navigation Active');
  (window as any).__hema_active = true;

  const runTick = async () => {
    if (!(window as any).__hema_active) return;

    // 1. Handle Videos (Speed up to 10x)
    document.querySelectorAll('video').forEach(v => {
      v.playbackRate = 10.0;
      if (v.paused && !v.ended) { v.muted = true; v.play().catch(() => { }); }
      if (v.duration && v.currentTime > v.duration - 1.2) v.currentTime = v.duration;
    });

    // 2. URL Strategy: Try to find a number to increment
    const currentURL = window.location.href;
    const urlParts = currentURL.split('/');
    const lastPart = urlParts[urlParts.length - 1];

    if (/^\d+$/.test(lastPart)) {
      const nextNum = parseInt(lastPart) + 1;
      urlParts[urlParts.length - 1] = nextNum.toString();
      const nextURL = urlParts.join('/');

      createVisualOverlay(`🚀 Navigating to Step ${nextNum}...`);
      window.location.href = nextURL;
      return;
    }

    // 3. Fallback: Find very specific "Next" links in a more targeted way
    // (Less "Deep Scan", more "Specific Search")
    const targets = Array.from(document.querySelectorAll('a, button')) as HTMLElement[];
    const keywords = /next|continue|complete|success|advance/i;

    const nextBtn = targets.find(el => {
      const text = (el.innerText || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      return keywords.test(text + aria) && text.length < 20;
    });

    if (nextBtn) {
      createVisualOverlay('🎯 Found Next (Targeted)');
      nextBtn.click();
      setTimeout(runTick, 8000);
    } else {
      createVisualOverlay('🔍 Waiting for module change...');
      setTimeout(runTick, 4000);
    }
  };

  runTick();
  return { success: true, message: 'URL Navigation mode active' };
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'solveQuiz') {
    solveQuiz(request.model || 'llama3', request.autoAdvance || false).then(sendResponse);
    return true;
  }
  if (request.action === 'autoCourse') {
    startCourseAutomation().then(sendResponse);
    return true;
  }
  if (request.action === 'stop') {
    (window as any).__hema_active = false;
    sendResponse({ success: true });
    return true;
  }
});



