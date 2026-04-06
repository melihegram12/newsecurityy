{
  "modelProviders": {
    "openai": [
      {
        "id": "qwen/qwen3.6-plus-preview:free",
        "name": "Qwen 3.6 Plus Preview (OpenRouter)",
        "baseUrl": "https://openrouter.ai/api/v1",
        "envKey": "OPENROUTER_API_KEY"
      }
    ]
  },
  "env": {
    "OPENROUTER_API_KEY": "BURAYA_OPENROUTER_KEY"
  },
  "security": {
    "auth": {
      "selectedType": "openai"
    }
  },
  "model": {
    "name": "qwen/qwen3.6-plus-preview:free"
  }
}