import { useState } from "react";

const API_BASE = "https://rag-chatbot-project-1-6yez.onrender.com";

export default function Signup({ onLogin, switchToLogin }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signup failed");

      localStorage.setItem("token", data.token);
      onLogin(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-16 p-6 border border-gray-200 rounded-lg">
      <h2 className="text-lg font-semibold mb-4">Create an account</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          required
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          required
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-800 text-white rounded py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </form>
      <p className="text-xs text-gray-500 mt-3 text-center">
        Already have an account?{" "}
        <button onClick={switchToLogin} className="text-slate-700 underline">
          Log in
        </button>
      </p>
    </div>
  );
}
