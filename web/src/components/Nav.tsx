import { Link } from "react-router-dom";
import { BookOpen, LayoutDashboard } from "lucide-react";
import { Button, Logo } from "./ui";

export function Nav({ app = false }: { app?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
        <Link to="/" className="flex items-center">
          <Logo />
        </Link>
        {!app ? (
          <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a href="/#how" className="hover:text-fg">How it works</a>
            <a href="/#features" className="hover:text-fg">Features</a>
            <a href="/#demo" className="hover:text-fg">Demo</a>
            <a href="/#architecture" className="hover:text-fg">Architecture</a>
            <a href="/#pricing" className="hover:text-fg">Pricing</a>
          </nav>
        ) : (
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            <Link to="/app" className="hover:text-fg">Projects</Link>
            <Link to="/app/new" className="hover:text-fg">New project</Link>
          </nav>
        )}
        <div className="flex items-center gap-2">
          <a href="/app" className="hidden rounded-lg p-2 text-muted hover:bg-white/5 hover:text-fg sm:block" aria-label="Docs">
            <BookOpen className="h-4 w-4" />
          </a>
          <Link to={app ? "/app/new" : "/app"}>
            <Button size="sm" icon={<LayoutDashboard className="h-4 w-4" />}>{app ? "New project" : "Open the Lab"}</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line/70">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-5 py-10 text-sm text-muted md:flex-row md:items-center">
        <div className="space-y-2">
          <Logo size={22} />
          <div className="text-xs text-dim">Break your APIs before your users do. Built on AWS Lambda · API Gateway · DynamoDB · S3 · Amazon Bedrock · CloudWatch · CloudFront.</div>
        </div>
        <div className="flex gap-6 text-xs">
          <Link to="/app" className="hover:text-fg">Launch app</Link>
          <a href="/#pricing" className="hover:text-fg">Pricing</a>
          <a href="/#architecture" className="hover:text-fg">Architecture</a>
          <span className="text-dim">© {new Date().getFullYear()} API Chaos Lab</span>
        </div>
      </div>
    </footer>
  );
}
