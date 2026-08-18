import { useState, useRef, useEffect } from "react";
import { Upload, Send, FileText, Loader2, X, BookOpen, LogOut } from "lucide-react";

const API_BASE = "https://rag-chatbot-project-1-6yez.onrender.com";

export default function RagChatInterface({ user, token, onLogout }) {
  const [file, setFile] = useState(null);
  const [documentId, setDocumentId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [docReady, setDocReady] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const handleFileSelect = (e) => {
    const f = e.target.files?.[0];
    if (f) uploadFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  };

  async function uploadFile(f) {
    if (f.type !== "application/pdf") {
      setError("Please upload a PDF file.");
      return;
    }
    setError("");
    setFile(f);
    setUploading(true);
    setDocReady(false);

    try {
      const formData = new FormData();
      formData.append("file", f);

      const res = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        headers: authHeaders,
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setDocumentId(data.document_id);
      setDocReady(true);
      setMessages([
        { role: "assistant", content: `I've processed "${f.name}". Ask me anything about it.`, sources: [] },
      ]);
    } catch (err) {
      setError(err.message);
      setFile(null);
    } finally {
      setUploading(false);
    }
  }

  function resetDoc() {
    setFile(null);
    setDocumentId(null);
    setDocReady(false);
    setMessages([]);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function sendMessage() {
    const question = input.trim();
    if (!question || sending || !documentId) return;

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat/${documentId}`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chat failed");

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, sources: data.sources || [] },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message}`, sources: [], isError: true },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col h-[600px] bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-slate-700" />
          <span className="font-medium text-slate-800 text-sm">Document Q&A — {user.name}</span>
        </div>
        <div className="flex items-center gap-3">
          {docReady && (
            <button onClick={resetDoc} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> New document
            </button>
          )}
          <button onClick={onLogout} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <LogOut className="w-3.5 h-3.5" /> Log out
          </button>
        </div>
      </div>

      {!docReady && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex-1 flex flex-col items-center justify-center gap-3 p-8 m-4 border-2 border-dashed border-gray-300 rounded-lg"
        >
          {uploading ? (
            <>
              <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
              <p className="text-sm text-gray-500">Processing {file?.name}...</p>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-400" />
              <p className="text-sm text-gray-600 text-center">
                Drop a PDF here, or
                <button onClick={() => fileInputRef.current?.click()} className="text-slate-700 font-medium underline ml-1">
                  browse files
                </button>
              </p>
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelect} className="hidden" />
            </>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}

      {docReady && (
        <>
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-gray-100 text-xs text-gray-500">
            <FileText className="w-3.5 h-3.5" />
            {file?.name}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === "user" ? "bg-slate-800 text-white" : msg.isError ? "bg-red-50 text-red-700 border border-red-100" : "bg-gray-100 text-gray-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.sources?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {msg.sources.map((s, idx) => (
                        <span key={idx} className="text-[10px] bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-500" title={s.text || ""}>
                          Source {idx + 1}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                  <span className="text-xs text-gray-500">Thinking...</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 p-3 flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about the document..."
              rows={1}
              className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sending}
              className="bg-slate-800 text-white rounded-lg p-2.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
