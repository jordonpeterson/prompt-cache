import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <nav className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <span className="text-xl font-bold">PromptCache</span>
          <div className="flex items-center gap-4">
            {user ? (
              <Link
                href="/dashboard"
                className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-slate-400 hover:text-white text-sm transition-colors">
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-full px-4 py-1.5 text-violet-400 text-sm mb-8">
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          Powered by pgvector + OpenAI embeddings
        </div>
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          Cache AI Results.{" "}
          <span className="text-violet-400">Ship Faster.</span>
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10">
          Stop paying for the same AI responses twice. PromptCache semantically matches
          incoming prompts to cached results, slashing latency and API costs.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/signup"
            className="bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-lg transition-colors text-lg"
          >
            Get started free
          </Link>
          <a
            href="#pricing"
            className="border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-semibold px-8 py-3 rounded-lg transition-colors text-lg"
          >
            View pricing
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">How it works</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            {
              icon: "🧠",
              title: "Semantic search",
              desc: "Uses OpenAI embeddings to find similar cached results, not just exact matches.",
            },
            {
              icon: "⚡",
              title: "REST API",
              desc: "Simple HTTP endpoints. Integrate in minutes with any language or framework.",
            },
            {
              icon: "🗄️",
              title: "pgvector backend",
              desc: "Battle-tested Postgres with HNSW indexes for millisecond similarity search.",
            },
            {
              icon: "💸",
              title: "Cut AI costs",
              desc: "Reuse results for semantically similar prompts. Pay your AI provider less.",
            },
          ].map((f) => (
            <div key={f.title} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">Pricing</h2>
        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {/* Free */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
            <h3 className="text-xl font-bold mb-1">Free</h3>
            <p className="text-4xl font-extrabold mt-4 mb-1">$0</p>
            <p className="text-slate-400 text-sm mb-6">Forever</p>
            <ul className="space-y-3 mb-8 text-sm text-slate-300">
              <li className="flex gap-2"><span className="text-green-400">✓</span> READ access to cached results</li>
              <li className="flex gap-2"><span className="text-green-400">✓</span> Semantic search API</li>
              <li className="flex gap-2"><span className="text-green-400">✓</span> Unlimited queries</li>
            </ul>
            <Link
              href="/signup"
              className="block text-center border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Get started
            </Link>
          </div>

          {/* Pro */}
          <div className="bg-slate-900 border border-violet-500/50 rounded-xl p-8 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
              Most popular
            </div>
            <h3 className="text-xl font-bold mb-1">Pro</h3>
            <p className="text-4xl font-extrabold mt-4 mb-1">$5</p>
            <p className="text-slate-400 text-sm mb-6">per month</p>
            <ul className="space-y-3 mb-8 text-sm text-slate-300">
              <li className="flex gap-2"><span className="text-green-400">✓</span> WRITE access — contribute results</li>
              <li className="flex gap-2"><span className="text-green-400">✓</span> Everything in Free</li>
              <li className="flex gap-2"><span className="text-green-400">✓</span> API key with WRITE permissions</li>
              <li className="flex gap-2"><span className="text-green-400">✓</span> Priority support</li>
            </ul>
            <Link
              href="/signup"
              className="block text-center bg-violet-600 hover:bg-violet-500 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Subscribe for $5/mo
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8 text-center text-slate-500 text-sm">
        © {new Date().getFullYear()} PromptCache. Built on Supabase + pgvector.
      </footer>
    </div>
  );
}
