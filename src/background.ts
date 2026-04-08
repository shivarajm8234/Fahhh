import { Ollama } from 'ollama/browser';

const ollama = new Ollama({ host: 'http://localhost:11434' });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'askOllama') {
    handleAskOllama(request.prompt, request.model)
      .then(response => sendResponse({ success: true, response }))
      .catch(error => {
        let msg = error.message;
        if (msg.includes('Failed to fetch')) {
          msg = 'Cannot connect to Ollama. Ensure it is running at localhost:11434';
        }
        sendResponse({ success: false, error: msg });
      });
    return true; // Keep channel open for async response
  }
  
  if (request.action === 'fetchModels') {
    fetch('http://localhost:11434/api/tags')
      .then(res => res.json())
      .then(data => sendResponse({ success: true, models: data.models }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleAskOllama(prompt: string, model: string = 'llama3') {
  try {
    // Basic connectivity check
    const response = await ollama.generate({
      model: model,
      prompt: prompt,
      stream: false,
    });
    return response.response;
  } catch (error: any) {
    console.error('Ollama communication error:', error);
    throw error;
  }
}

