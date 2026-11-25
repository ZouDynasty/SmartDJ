import {
  AudioLines,
  Clock3,
  Disc3,
  Layers3,
  Moon,
  Sun,
  SlidersHorizontal,
} from "lucide-react";
import { AccountButton } from "./AccountButton";
import { useTheme } from "@/lib/theme";

interface Props {
  name: string;
  count: number;
  duration: string;
  library: string;
  connected: boolean;
}
export function StudioHeader({
  name,
  count,
  duration,
  library,
  connected,
}: Props) {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <header className="studio-nav">
        <div className="studio-brand">
          <span className="brand-symbol">
            <AudioLines aria-hidden="true" size={23} />
          </span>
          SmartDJ
        </div>
        <span className="nav-divider" />
        <span className="workspace-label">
          <SlidersHorizontal size={14} /> Workspace
        </span>
        <span className="nav-status" title={library}>
          <i className={connected ? "connected" : ""} />
          {library}
        </span>
        <button
          className="theme-switch"
          type="button"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <AccountButton />
      </header>
      <section className="studio-banner" aria-labelledby="studio-title">
        <div className="studio-kicker">
          <span /> MIXING WORKSPACE
        </div>
        <h1 id="studio-title">
          Set Builder<span>.</span>
        </h1>
        <div className="session-meta">
          <span>
            <Disc3 />
            {name}
          </span>
          <b>/</b>
          <span>
            <Layers3 />
            {count} tracks
          </span>
          <b>/</b>
          <span>
            <Clock3 />
            {duration}
          </span>
        </div>
      </section>
    </>
  );
}
