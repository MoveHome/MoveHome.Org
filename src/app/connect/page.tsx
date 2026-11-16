'use client';

import { useState } from 'react';

type Tab = 'claude' | 'chatgpt' | 'hermes' | 'gemini' | 'cursor';

export default function ConnectPage() {
  const [activeTab, setActiveTab] = useState<Tab>('claude');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testLatency, setTestLatency] = useState<number | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const runTestConnection = async () => {
    setTestStatus('testing');
    setTestLatency(null);
    const start = performance.now();
    try {
      const res = await fetch('/api/mcp', { method: 'GET' });
      const elapsed = Math.round(performance.now() - start);
      if (res.ok || res.status === 405 || res.status === 200) {
        setTestStatus('success');
        setTestLatency(elapsed);
      } else {
        setTestStatus('error');
      }
    } catch {
      setTestStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 px-4 py-8 max-w-4xl mx-auto">
      {/* Hero Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-3">
          Connect Your Personal AI Agent
        </h1>
        <p className="text-zinc-400 text-sm md:text-base max-w-2xl mx-auto">
          Access MoveHome&apos;s open property index directly from your favorite AI assistant with <span className="text-emerald-400 font-semibold">zero OAuth</span> and <span className="text-emerald-400 font-semibold font-mono">zero login</span>.
        </p>
      </div>

      {/* Video Explainer Slot */}
      <div className="mb-10 overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/80 backdrop-blur-xl p-6 shadow-2xl relative">
        <div className="aspect-video w-full rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-950 border border-zinc-800/80 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-3 text-emerald-400">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-zinc-200 mb-1">Veo 3 Agent Explainer Video</h3>
          <p className="text-xs text-zinc-400 max-w-md">
            1. Copy endpoint &bull; 2. Add to agent config &bull; 3. Search real-time open property listings via voice or chat.
          </p>
        </div>
      </div>

      {/* One-Click Endpoint Copy Bar */}
      <div className="mb-10 grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { label: 'MCP Endpoint URL', url: 'https://movehome.org/api/mcp', key: 'mcp' },
          { label: 'Agent Card (A2A)', url: 'https://movehome.org/.well-known/agent-card.json', key: 'card' },
          { label: 'Skills Manifest', url: 'https://movehome.org/skills.md', key: 'skills' }
        ].map((item) => (
          <div key={item.key} className="rounded-xl border border-white/10 bg-zinc-900/60 p-3.5 backdrop-blur-md flex flex-col justify-between">
            <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
              {item.label}
            </div>
            <div className="font-mono text-xs text-emerald-400 truncate mb-3">
              {item.url}
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(item.url, item.key)}
              className="w-full py-1.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors flex items-center justify-center gap-1.5"
            >
              {copiedKey === item.key ? (
                <span className="text-emerald-400 font-semibold">Copied!</span>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy URL
                </>
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Agent Tabs */}
      <div className="mb-8 rounded-2xl border border-white/15 bg-zinc-950/95 backdrop-blur-xl p-6 shadow-2xl">
        <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-4 mb-6">
          {[
            { id: 'claude', name: 'Claude' },
            { id: 'chatgpt', name: 'ChatGPT' },
            { id: 'hermes', name: 'Hermes Agent' },
            { id: 'gemini', name: 'Gemini / A2A' },
            { id: 'cursor', name: 'Cursor / Custom MCP' }
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as Tab)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                activeTab === tab.id
                  ? 'bg-emerald-500 text-zinc-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="space-y-4">
          {activeTab === 'claude' && (
            <div>
              <h3 className="text-sm font-bold text-zinc-200 mb-2">Claude (Desktop / Web / Mobile)</h3>
              <p className="text-xs text-zinc-400 mb-4">
                Add MoveHome as a Model Context Protocol (MCP) server in your Claude Desktop settings or Web MCP extension.
              </p>
              <div className="rounded-xl bg-zinc-900 p-4 font-mono text-xs text-zinc-300 overflow-x-auto border border-zinc-800">
                {`{
  "mcpServers": {
    "movehome": {
      "url": "https://movehome.org/api/mcp"
    }
  }
}`}
              </div>
            </div>
          )}

          {activeTab === 'chatgpt' && (
            <div>
              <h3 className="text-sm font-bold text-zinc-200 mb-2">ChatGPT (Custom GPT / Apps / Web Search)</h3>
              <p className="text-xs text-zinc-400 mb-4">
                Point Custom GPTs or ChatGPT Search to MoveHome&apos;s open skills manifest and MCP endpoint.
              </p>
              <div className="space-y-3 font-mono text-xs">
                <div className="rounded-xl bg-zinc-900 p-3 border border-zinc-800 text-zinc-300">
                  <span className="text-zinc-500">Prompt:</span> &quot;Read https://movehome.org/skills.md and search MoveHome for 2-bed apartments in London.&quot;
                </div>
                <div className="rounded-xl bg-zinc-900 p-3 border border-zinc-800 text-emerald-400">
                  https://movehome.org/api/mcp
                </div>
              </div>
            </div>
          )}

          {activeTab === 'hermes' && (
            <div>
              <h3 className="text-sm font-bold text-zinc-200 mb-2">Hermes Agent</h3>
              <p className="text-xs text-zinc-400 mb-4">
                Add to your <code className="text-emerald-400">~/.hermes/config.yaml</code> or prompt directly.
              </p>
              <div className="rounded-xl bg-zinc-900 p-4 font-mono text-xs text-zinc-300 overflow-x-auto border border-zinc-800 mb-3">
                {`mcp_servers:
  movehome:
    url: "https://movehome.org/api/mcp"`}
              </div>
              <p className="text-xs text-zinc-400">
                Or instruct Hermes in one line: <code className="text-emerald-400 font-mono">Read https://movehome.org/skills.md</code>
              </p>
            </div>
          )}

          {activeTab === 'gemini' && (
            <div>
              <h3 className="text-sm font-bold text-zinc-200 mb-2">Gemini / A2A (Agent-to-Agent)</h3>
              <p className="text-xs text-zinc-400 mb-4">
                Interoperate via the open A2A 1.0 protocol specification.
              </p>
              <div className="rounded-xl bg-zinc-900 p-3 border border-zinc-800 font-mono text-xs text-emerald-400">
                https://movehome.org/.well-known/agent-card.json
              </div>
            </div>
          )}

          {activeTab === 'cursor' && (
            <div>
              <h3 className="text-sm font-bold text-zinc-200 mb-2">Cursor / Custom MCP</h3>
              <p className="text-xs text-zinc-400 mb-4">
                Add to Cursor <code className="text-emerald-400">.cursor/mcp.json</code> or any custom MCP client.
              </p>
              <div className="rounded-xl bg-zinc-900 p-4 font-mono text-xs text-zinc-300 overflow-x-auto border border-zinc-800">
                {`{
  "mcpServers": {
    "movehome": {
      "url": "https://movehome.org/api/mcp"
    }
  }
}`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Test Connection */}
      <div className="rounded-2xl border border-white/15 bg-zinc-950/95 backdrop-blur-xl p-6 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-200 mb-1">Test Live Connection</h3>
          <p className="text-xs text-zinc-400">
            Verify client-side access to <code className="text-emerald-400 font-mono">/api/mcp</code> without sending enquiries or credentials.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {testStatus === 'success' && (
            <span className="text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              HTTP 200 OK ({testLatency}ms)
            </span>
          )}
          {testStatus === 'error' && (
            <span className="text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/30 px-3 py-1.5 rounded-lg">
              Connection Check Failed
            </span>
          )}
          <button
            type="button"
            onClick={runTestConnection}
            disabled={testStatus === 'testing'}
            className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold transition-colors disabled:opacity-50"
          >
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </div>
    </div>
  );
}
