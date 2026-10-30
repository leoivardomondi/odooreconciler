import assert from 'node:assert/strict';
import test from 'node:test';
import { isVisionConfigured } from './index';

test('isVisionConfigured returns true for OpenAI vision models with API key', () => {
  const gpt4oConfig = {
    enabled: true,
    provider: 'openai' as const,
    model: 'gpt-4o',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 4,
    apiKeys: {
      openai: 'sk-test-key',
      nvidia: '',
      gemini: '',
      anthropic: '',
      openrouter: '',
    },
  };

  assert.equal(isVisionConfigured(gpt4oConfig), true);

  const gpt4oMiniConfig = {
    ...gpt4oConfig,
    model: 'gpt-4o-mini',
  };
  assert.equal(isVisionConfigured(gpt4oMiniConfig), true);
});

test('isVisionConfigured returns false for text-only OpenAI models', () => {
  const o3MiniConfig = {
    enabled: true,
    provider: 'openai' as const,
    model: 'o3-mini',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 4,
    apiKeys: {
      openai: 'sk-test-key',
      nvidia: '',
      gemini: '',
      anthropic: '',
      openrouter: '',
    },
  };

  assert.equal(isVisionConfigured(o3MiniConfig), false);
});

test('isVisionConfigured returns true for NVIDIA vision models', () => {
  const gemmaConfig = {
    enabled: true,
    provider: 'nvidia' as const,
    model: 'google/gemma-4-31b-it',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 4,
    apiKeys: {
      openai: '',
      nvidia: 'nvapi-test-key',
      gemini: '',
      anthropic: '',
      openrouter: '',
    },
  };

  assert.equal(isVisionConfigured(gemmaConfig), true);
});

test('isVisionConfigured returns true for Claude and Gemini vision models with keys', () => {
  const claudeConfig = {
    enabled: true,
    provider: 'anthropic' as const,
    model: 'claude-3-7-sonnet-latest',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 4,
    apiKeys: {
      openai: '',
      nvidia: '',
      gemini: '',
      anthropic: 'sk-ant-test-key',
      openrouter: '',
    },
  };
  assert.equal(isVisionConfigured(claudeConfig), true);

  const geminiConfig = {
    enabled: true,
    provider: 'gemini' as const,
    model: 'gemini-3.8-flash',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 4,
    apiKeys: {
      openai: '',
      nvidia: '',
      gemini: 'AIzaSy-test-key',
      anthropic: '',
      openrouter: '',
    },
  };
  assert.equal(isVisionConfigured(geminiConfig), true);
});

test('isVisionConfigured returns false when disabled or missing credentials', () => {
  const disabledConfig = {
    enabled: false,
    provider: 'openai' as const,
    model: 'gpt-4o',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 4,
    apiKeys: {
      openai: 'sk-test-key',
      nvidia: '',
      gemini: '',
      anthropic: '',
      openrouter: '',
    },
  };
  assert.equal(isVisionConfigured(disabledConfig), false);

  const missingKeyConfig = {
    enabled: true,
    provider: 'openai' as const,
    model: 'gpt-4o',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 4,
    apiKeys: {
      openai: '',
      nvidia: '',
      gemini: '',
      anthropic: '',
      openrouter: '',
    },
  };
  const prevEnv = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(isVisionConfigured(missingKeyConfig), false);
  } finally {
    if (prevEnv) process.env.OPENAI_API_KEY = prevEnv;
  }
});

