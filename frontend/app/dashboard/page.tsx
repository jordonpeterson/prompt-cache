import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SubscribeButton from "./subscribe-button";
import { CopyKey } from "./copy-key";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: apiKey } = await supabase
    .from("api_keys")
    .select("key, permissions, created_at")
    .eq("supabase_user_id", user.id)
    .single();

  const params = await searchParams;
  const justSubscribed = params.success === "true";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <span className="text-xl font-bold">PromptCache</span>
          <form action={signOut}>
            <button
              type="submit"
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
          <p className="text-slate-400">Welcome back, {user.email}</p>
        </div>

        {justSubscribed && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-green-400">
            Subscription activated! Your API key has been provisioned below.
          </div>
        )}

        {apiKey ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Your API Key</h2>
              <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-1 rounded-full">
                {apiKey.permissions}
              </span>
            </div>
            <CopyKey apiKey={apiKey.key} />
            <p className="text-xs text-slate-500">
              Created {new Date(apiKey.created_at).toLocaleDateString()}
            </p>
            <div className="pt-2 border-t border-slate-800">
              <p className="text-sm text-slate-400 mb-2">Usage example:</p>
              <pre className="bg-slate-800 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap break-all">
                {`curl -X POST https://your-project.supabase.co/functions/v1/search \\
  -H "x-api-key: ${apiKey.key}" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "your prompt here"}'`}
              </pre>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Get API Access</h2>
            <p className="text-slate-400">
              Subscribe to get your API key with WRITE permissions. $5/month, cancel anytime.
            </p>
            <SubscribeButton />
          </div>
        )}
      </main>
    </div>
  );
}
