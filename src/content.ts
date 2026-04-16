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
      padding: 14px 24px;
      background: rgba(10, 15, 25, 0.85);
      color: #00f2ff;
      border: 1px solid rgba(0, 242, 255, 0.4);
      border-radius: 12px;
      font-family: 'Outfit', 'Inter', sans-serif;
      font-size: 14px;
      font-weight: 700;
      z-index: 999999;
      box-shadow: 0 0 20px rgba(0, 242, 255, 0.2), inset 0 0 10px rgba(0, 242, 255, 0.1);
      backdrop-filter: blur(12px);
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      display: flex;
      align-items: center;
      gap: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
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
      @keyframes hema-pulse { 0% { opacity: 0.8; } 50% { opacity: 1; } 100% { opacity: 0.8; } }
      .hema-spinner { 
        width: 16px; height: 16px; 
        border: 2px solid rgba(0, 242, 255, 0.2); 
        border-top-color: #00f2ff; 
        border-radius: 50%; 
        animation: hema-spin 0.8s linear infinite; 
      }
      #hema-ai-overlay span { animation: hema-pulse 2s ease-in-out infinite; }
      .hema-highlight-question { outline: 2px solid #00f2ff !important; outline-offset: 4px; box-shadow: 0 0 15px rgba(0, 242, 255, 0.4) !important; border-radius: 4px; transition: all 0.3s; }
      .hema-highlight-option { outline: 2px solid #10b981 !important; outline-offset: 2px; border-radius: 4px; background: rgba(16, 185, 129, 0.1) !important; box-shadow: 0 0 10px rgba(16, 185, 129, 0.3) !important; }
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

function showFlashMessage(msg: string, type: 'error' | 'info' | 'success' = 'info') {
  const colors = {
    error: '#ff4444',
    info: '#00f2ff',
    success: '#10b981'
  };
  createVisualOverlay(`<span style="color: ${colors[type]}">${msg}</span>`);
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
  createVisualOverlay('📡 Course Automation Active');
  (window as any).__hema_active = true;
  let errorCount = 0;

  const findNextButton = (): HTMLElement | null => {
    // Collect all potential buttons and links
    const targets = Array.from(document.querySelectorAll('a, button, [role="button"], .mat-button, .mat-raised-button')) as HTMLElement[];
    
    // Springboard/Wingspan specific logic:
    // They often use mat-icon-button with "navigate_next" or similar
    const priorityKeywords = /complete|mark as done|finish|done|success|verify|check|mark as read/i;
    const generalKeywords = /next|continue|advance|got it|proceed|skip|right arrow|navigate_next/i;
    
    const visibleTargets = targets.filter(t => {
      const rect = t.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(t).display !== 'none';
    });
    
    // 1. Check for specific "Complete" actions
    let found = visibleTargets.find(el => {
      const txt = (el.innerText || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      return priorityKeywords.test(txt + aria + title) && (txt + aria + title).length < 60;
    });

    // 2. Check for "Next" logic
    if (!found) {
      found = visibleTargets.find(el => {
        const txt = (el.innerText || '').trim();
        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        // Look for common icons or class names if text is empty
        const hasNextIcon = el.querySelector('.material-icons')?.innerHTML.includes('next') || 
                          el.className.includes('next') || 
                          el.id.includes('next');
        
        return (generalKeywords.test(txt + aria + title) || hasNextIcon) && (txt + aria + title).length < 60;
      });
    }

    return (found as HTMLElement) || null;
  };

  const hasTextContent = (): boolean => {
    // Filter out scripts and styles to get real content
    const clone = document.body.cloneNode(true) as HTMLElement;
    const toRemove = clone.querySelectorAll('script, style, #hema-ai-overlay');
    toRemove.forEach(r => r.remove());
    const content = clone.innerText.trim();
    return content.length > 500;
  };

  const runTick = async () => {
    if (!(window as any).__hema_active) return;

    const videos = Array.from(document.querySelectorAll('video'));
    const nextBtn = findNextButton();

    // --- CASE 1: VIDEOS PRESENT ---
    if (videos.length > 0) {
      let anyVideoWorking = false;
      let allEnded = true;

      for (const v of videos) {
        // 1. Handle errors (403 Forbidden, manifest errors)
        if (v.error || (v.networkState === 3)) { // networkState 3 = NETWORK_NO_SOURCE
          errorCount++;
          if (errorCount > 10) { // Persistent failure
            showFlashMessage('🚨 403 / Network Error. AUTO-REFRESHING...', 'error');
            setTimeout(() => window.location.reload(), 2000);
            return;
          }
          continue;
        }

        // 2. Playback speed enforcement (Model-free 5x)
        const targetRate = 5.0;
        if (v.readyState >= 2) { // HAVE_CURRENT_DATA
          if (Math.abs(v.playbackRate - targetRate) > 0.1 && !v.ended) {
            try {
              v.playbackRate = targetRate;
              // Some players override playbackRate. We can try to lock it if needed, 
              // but repeated setting is usually enough.
            } catch (e) {
              console.warn('HEMA: Playback rate lock failed');
            }
          }
          
          v.muted = true;
          anyVideoWorking = true;

          // 3. Auto-play logic
          if (v.paused && !v.ended) {
            v.play().catch(() => {
              showFlashMessage('⏸️ Interaction Required. CLICK PAGE.', 'info');
            });
          }
        } else {
          showFlashMessage('⏳ Buffering / Loading Data...', 'info');
          allEnded = false;
        }

        if (!v.ended) {
          allEnded = false;
        }
      }

      if (allEnded && videos.length > 0) {
        showFlashMessage('✅ Task Finished. Advancing...', 'success');
        const btn = findNextButton();
        if (btn) {
          btn.click();
          setTimeout(runTick, 7000); // Wait for load
        } else {
          // Fallback: Try to find ANY button that looks like navigation
          const fallback = document.querySelector('button[mat-icon-button], .next-btn') as HTMLElement;
          if (fallback) fallback.click();
          setTimeout(runTick, 5000);
        }
      } else {
        if (anyVideoWorking) {
          errorCount = 0; // Reset error count if something is playing
          createVisualOverlay(`⚡ Speed Warp: 5.0x Active`);
        }
        setTimeout(runTick, 1000);
      }
      return;
    }

    // --- CASE 2: TEXT CONTENT ---
    if (hasTextContent()) {
      showFlashMessage('📄 Analyzing Content Assets...', 'info');
      // Scroll in chunks to simulate reading more naturally
      let scrolled = 0;
      const step = document.body.scrollHeight / 5;
      const interval = setInterval(() => {
        scrolled += step;
        window.scrollTo({ top: scrolled, behavior: 'smooth' });
        if (scrolled >= document.body.scrollHeight) {
          clearInterval(interval);
          finishTextContent();
        }
      }, 500);

      const finishTextContent = () => {
        if (!(window as any).__hema_active) return;
        showFlashMessage('🎯 Checkpoint Reached. Next Target...', 'success');
        const btn = findNextButton();
        if (btn) {
          btn.click();
          setTimeout(runTick, 7000);
        } else {
          setTimeout(runTick, 5000);
        }
      };
      return;
    }

    // --- CASE 3: FALLBACK ---
    if (nextBtn) {
      showFlashMessage('⏭️ Module Empty. Skipping...', 'info');
      nextBtn.click();
      setTimeout(runTick, 7000);
    } else {
      setTimeout(runTick, 5000);
    }
  };

  runTick();
  return { success: true, message: 'Warp Engine Engaged (5x)' };
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



