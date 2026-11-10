// The research worker's status in one line, from what the worker last reported (never from the web
// server's own environment). Server-safe: no hooks.
import { Notice } from "@/components/ui/Form";
import type { WorkerLine } from "@/lib/workerStatus";

export function WorkerStatusLine({ line, forAdmin = false }: { line: WorkerLine & { version?: string | null }; forAdmin?: boolean }) {
  return (
    <Notice tone={line.tone}>
      <p>
        {line.text}
        {line.state === "running" && line.version ? <span className="text-[12px]"> Version {line.version}.</span> : null}
      </p>
      {forAdmin && line.state === "missing" ? (
        <p className="mt-1 text-[13px]">The worker is a separate service from the website. See “Research worker” in docs/DEPLOYMENT.md to start it.</p>
      ) : null}
      {forAdmin && line.state === "unconfigured" ? (
        <p className="mt-1 text-[13px]">Set ANTHROPIC_API_KEY on the worker&apos;s host only: never on the website host, in the browser or in the repository.</p>
      ) : null}
    </Notice>
  );
}
