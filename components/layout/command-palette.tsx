"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";
import { ALL_NAV_ITEMS } from "@/lib/nav";
import { cx } from "@/lib/format";
import { SCENARIOS } from "@/lib/sim/scenarios";
import { SERVICES } from "@/lib/sim/services";
import { useSimStore } from "@/lib/store/sim-store";

/**
 * Command palette (⌘K / Ctrl+K).
 *
 * Searches three things at once — pages, services and incident scenarios — so
 * it works as navigation *and* as a launcher. Implemented with a listbox
 * pattern: the input keeps focus and owns the keyboard, while `aria-activedescendant`
 * tells assistive technology which option is highlighted.
 */

interface Command {
  id: string;
  label: string;
  description: string;
  group: string;
  keywords: string;
  run: () => void;
}

/**
 * Mounted only while open, so its state starts fresh every time and no effect
 * has to reset it. That is why there is no `open` prop.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const triggerScenario = useSimStore((s) => s.triggerScenario);
  const togglePause = useSimStore((s) => s.togglePause);
  const abortIncident = useSimStore((s) => s.abortIncident);
  const hasActive = useSimStore((s) => s.state.active !== null);

  const commands = useMemo<Command[]>(() => {
    const navCommands: Command[] = ALL_NAV_ITEMS.map((item) => ({
      id: `nav:${item.href}`,
      label: item.label,
      description: item.description,
      group: "Navigate",
      keywords: `${item.label} ${item.description} ${item.aliases ?? ""}`,
      run: () => router.push(item.href),
    }));

    const serviceCommands: Command[] = SERVICES.map((service) => ({
      id: `service:${service.id}`,
      label: service.name,
      description: `${service.team} · ${service.hostname}`,
      group: "Services",
      keywords: `${service.name} ${service.hostname} ${service.ip} ${service.team} ${service.id}`,
      run: () => router.push(`/services?service=${service.id}`),
    }));

    const scenarioCommands: Command[] = hasActive
      ? []
      : SCENARIOS.map((scenario) => ({
          id: `scenario:${scenario.id}`,
          label: `Trigger: ${scenario.title}`,
          description: scenario.summary,
          group: "Simulate",
          keywords: `trigger incident simulate ${scenario.title} ${scenario.summary}`,
          run: () => {
            triggerScenario(scenario.id);
            router.push("/simulation");
          },
        }));

    const actions: Command[] = [
      {
        id: "action:pause",
        label: "Pause / resume simulation",
        description: "Freeze the operations clock",
        group: "Actions",
        keywords: "pause resume stop start clock freeze time",
        run: togglePause,
      },
      // Only offered while there is something to end.
      ...(hasActive
        ? [
            {
              id: "action:abort",
              label: "End current incident",
              description: "Return every service to baseline and close the run as abandoned",
              group: "Actions",
              keywords: "end abort stop cancel clear incident restart fresh reset scenario",
              run: () => {
                abortIncident();
                router.push("/simulation");
              },
            },
          ]
        : []),
    ];

    return [...navCommands, ...scenarioCommands, ...serviceCommands, ...actions];
  }, [router, triggerScenario, togglePause, abortIncident, hasActive]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 10);
    return commands
      .filter((command) => command.keywords.toLowerCase().includes(q))
      .slice(0, 12);
  }, [commands, query]);

  // Focus the input on mount so typing works immediately.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    const node = listRef.current?.children[highlighted] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const command = results[highlighted];
        if (command) {
          command.run();
          onClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [results, highlighted, onClose]);

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center px-4 pt-[12vh]">
      <div
        className="anim-fade-in absolute inset-0 bg-void/75 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="anim-scale-in panel relative z-10 w-full max-w-xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={15} className="shrink-0 text-ink-4" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[highlighted] ? `cmd-${results[highlighted].id}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            placeholder="Search pages, services and scenarios…"
            className="h-12 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          <kbd className="shrink-0 rounded border border-line bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-ink-4">
            ESC
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="command-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto p-1.5"
        >
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-ink-4">
              No matches for “{query}”
            </li>
          ) : (
            results.map((command, index) => {
              const showGroup = command.group !== lastGroup;
              lastGroup = command.group;
              const active = index === highlighted;

              return (
                <li key={command.id}>
                  {showGroup ? (
                    <p className="px-2.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-4">
                      {command.group}
                    </p>
                  ) : null}
                  <div
                    id={`cmd-${command.id}`}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => {
                      command.run();
                      onClose();
                    }}
                    className={cx(
                      "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 transition-colors",
                      active ? "bg-surface-4" : "hover:bg-surface-3",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">{command.label}</p>
                      <p className="truncate text-[11.5px] text-ink-4">{command.description}</p>
                    </div>
                    {active ? (
                      <CornerDownLeft size={13} className="shrink-0 text-ink-4" aria-hidden="true" />
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
