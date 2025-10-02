import React, { useEffect, useMemo, useRef, useState } from "react";

// =======================
// Balanceador Trifásico R/S/T — Somente "Copiar tabela" (sem salvar CSV)
// =======================

const PHASES = ["R", "S", "T"] as const;
type Phase = typeof PHASES[number];
type LoadType = "monofasico" | "bifasico" | "trifasico";
type BiPair = "RS" | "ST" | "RT";

type LoadItem = {
  id: string;
  nome: string;
  tipo: LoadType;
  fase?: Phase;
  par?: BiPair;
  corrente: number;
};

const STORAGE_KEY = "phaseBalancerLoads_v1";

function classNames(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function App() {
  // ===== estados principais
  const [loads, setLoads] = useState<LoadItem[]>([]);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<LoadType>("monofasico");
  const [fase, setFase] = useState<Phase>("R");
  const [par, setPar] = useState<BiPair>("RS");
  const [corrente, setCorrente] = useState("");
  const [limite, setLimite] = useState(""); // limite do sistema por fase (opcional)
  const [autoClear, setAutoClear] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ===== persistência
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setLoads(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loads)); } catch {}
  }, [loads]);

  // ===== cálculos de totais
  const totals = useMemo(() => {
    const t = { R: 0, S: 0, T: 0 } as Record<Phase, number>;
    for (const it of loads) {
      const A = it.corrente || 0;
      if (it.tipo === "monofasico" && it.fase) t[it.fase] += A;
      else if (it.tipo === "bifasico" && it.par) {
        if (it.par.includes("R")) t.R += A;
        if (it.par.includes("S")) t.S += A;
        if (it.par.includes("T")) t.T += A;
      } else if (it.tipo === "trifasico") {
        t.R += A; t.S += A; t.T += A;
      }
    }
    return t;
  }, [loads]);

  const limitA = parseFloat(limite.replace(",", "."));
  const limitActive = Number.isFinite(limitA) && limitA > 0;
  const maxTotal = Math.max(totals.R, totals.S, totals.T, 1);
  const totalSum = totals.R + totals.S + totals.T;

  const imbalance = useMemo(() => {
    const vals = [totals.R, totals.S, totals.T];
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const avg = (vals[0] + vals[1] + vals[2]) / 3;
    return { max, min, avg, percent: avg ? ((max - min) / avg) * 100 : 0 };
  }, [totals]);

  // ===== ações
  function defaultName() {
    if (tipo === "monofasico") return `Mono ${fase}`;
    if (tipo === "bifasico") return `Bi ${par}`;
    return "Tri";
  }

  function addLoad() {
    const A = parseFloat(corrente.replace(",", "."));
    if (!Number.isFinite(A) || A <= 0) return alert("Informe a corrente em A (número positivo).");
    const item: LoadItem = {
      id: crypto.randomUUID(),
      nome: (nome.trim() || defaultName()),
      tipo,
      corrente: Number(A.toFixed(2)),
      ...(tipo === "monofasico" ? { fase } : {}),
      ...(tipo === "bifasico" ? { par } : {}),
    };
    setLoads(prev => [item, ...prev]);
    if (autoClear) {
      setNome(""); setCorrente(""); setTipo("monofasico"); setFase("R"); setPar("RS");
    }
  }

  function removeLoad(id: string) {
    setLoads(prev => prev.filter(l => l.id !== id));
  }

  function clearAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setLoads([]);
    setNome(""); setCorrente(""); setTipo("monofasico"); setFase("R"); setPar("RS");
  }

  // ===== recomendação
  function cloneTotals(t: Record<Phase, number>) { return { R: t.R, S: t.S, T: t.T }; }
  function deltaPercent(t: Record<Phase, number>) {
    const v = [t.R, t.S, t.T];
    const max = Math.max(...v); const min = Math.min(...v); const avg = (v[0]+v[1]+v[2])/3;
    return { max, min, avg, percent: avg ? ((max-min)/avg)*100 : 0 };
  }
  function projectAdd(t: Record<Phase, number>, kind: LoadType, A: number, target?: Phase|BiPair) {
    const p = cloneTotals(t);
    if (kind === "monofasico" && target && typeof target === "string") {
      p[target as Phase] += A;
    } else if (kind === "bifasico" && target && typeof target === "string") {
      const pair = target as BiPair;
      if (pair.includes("R")) p.R += A;
      if (pair.includes("S")) p.S += A;
      if (pair.includes("T")) p.T += A;
    } else if (kind === "trifasico") {
      p.R += A; p.S += A; p.T += A;
    }
    return { totals: p, d: deltaPercent(p) };
  }

  const recommendation = useMemo(() => {
    const A = parseFloat(corrente.replace(",", "."));
    if (!Number.isFinite(A) || A <= 0) return null;
    if (tipo === "monofasico") {
      const opts = PHASES.map(ph => ({ target: ph, proj: projectAdd(totals, "monofasico", A, ph) }))
        .map(o => ({ target: o.target, score: o.proj.d.percent, proj: o.proj }))
        .sort((a,b)=>a.score-b.score);
      return { tipo, best: opts[0] } as const;
    }
    if (tipo === "bifasico") {
      const pairs: BiPair[] = ["RS","ST","RT"];
      const opts = pairs.map(pair => ({ target: pair, proj: projectAdd(totals, "bifasico", A, pair) }))
        .map(o => ({ target: o.target, score: o.proj.d.percent, proj: o.proj }))
        .sort((a,b)=>a.score-b.score);
      return { tipo, best: opts[0] } as const;
    }
    if (tipo === "trifasico") {
      const proj = projectAdd(totals, "trifasico", A);
      return { tipo, best: { target: "RST", score: proj.d.percent, proj } } as const;
    }
    return null;
  }, [tipo, corrente, totals]);

  function applyRecommendation() {
    if (!recommendation) return alert("Informe a corrente para receber sugestão.");
    const A = parseFloat(corrente.replace(",", "."));
    if (!Number.isFinite(A) || A <= 0) return alert("Corrente inválida.");
    const base: LoadItem = {
      id: crypto.randomUUID(),
      nome: (nome.trim() || defaultName()),
      tipo,
      corrente: Number(A.toFixed(2)),
    };
    if (tipo === "monofasico") base.fase = recommendation.best.target as Phase;
    if (tipo === "bifasico") base.par = recommendation.best.target as BiPair;
    setLoads(prev => [base, ...prev]);
    if (autoClear) { setNome(""); setCorrente(""); setTipo("monofasico"); setFase("R"); setPar("RS"); }
  }

  // ===== Copiar tabela (TSV com BOM) =====
  async function copyTable() {
    const header = ["Equipamento","Tipo","Fases","Corrente (A)"];
    const rows = loads.map(l => {
      const tipoLabel = l.tipo === "monofasico" ? "Monofásico" : l.tipo === "bifasico" ? "Bifásico" : "Trifásico";
      const fases = l.tipo === "monofasico" ? (l.fase || "") : l.tipo === "bifasico" ? (l.par || "") : "R,S,T";
      const correnteStr = String(l.corrente).replace(".", ",");
      return [l.nome, tipoLabel, fases, correnteStr];
    });

    // Bloco com totais por fase ao final
    const totalsBlock = [
      [],
      ["Totais por fase"],
      ["R", String(totals.R).replace(".", ",")],
      ["S", String(totals.S).replace(".", ",")],
      ["T", String(totals.T).replace(".", ",")],
    ];

    const lines = [header, ...rows, ...totalsBlock]
      .map(r => r.join('\t'))
      .join('\r\n');

    const payload = '\uFEFF' + lines;

    try {
      await navigator.clipboard.writeText(payload);
      alert("Tabela copiada para a área de transferência.");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        alert("Tabela copiada (fallback).");
      } catch {
        alert("Não foi possível copiar automaticamente. Selecione e copie manualmente o conteúdo exportado.");
      }
    }
  }

  // ===== Importar CSV =====
  function triggerImport() { fileInputRef.current?.click(); }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
        const [h, ...rows] = lines;
        const idx = (name: string) => h.split(",").findIndex(x => x.replace(/"/g, "").trim() === name);
        const iNome = idx("nome"); const iTipo = idx("tipo"); const iFases = idx("fases"); const iCorr = idx("corrente_A");
        const out: LoadItem[] = rows.map(line => {
          const cols = line.match(/\"([^\"]|\"\")*\"|[^,]+/g)?.map(c => c.replace(/^\"|\"$/g,"").replace(/\"\"/g,'"')) || [];
          const tipo = (cols[iTipo] as LoadType) || "monofasico";
          const fasesCell = cols[iFases] || "";
          const corrente = parseFloat((cols[iCorr] || "0").replace(",", ".")) || 0;
          const base: LoadItem = {
            id: crypto.randomUUID(),
            nome: cols[iNome] || "",
            tipo,
            corrente: Number(corrente.toFixed(2)),
          };
          if (tipo === "monofasico" && (fasesCell === "R" || fasesCell === "S" || fasesCell === "T")) base.fase = fasesCell as Phase;
          if (tipo === "bifasico" && (fasesCell === "RS" || fasesCell === "ST" || fasesCell === "RT")) base.par = fasesCell as BiPair;
          return base;
        });
        setLoads(out);
      } catch (err) { alert("Falha ao importar CSV."); }
    };
    reader.readAsText(f, "utf-8");
    e.target.value = "";
  }

  // ===== UI =====
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight">Balanceador de Carga Trifásico (R / S / T)</h1>
          <p className="text-sm text-slate-600">Some equipamentos como Monofásico, Bifásico (RS, ST, RT) ou Trifásico e acompanhe a corrente por fase. O valor em A é a corrente de linha do equipamento.</p>
        </header>

        {/* Configuração do sistema */}
        <section className="mb-3 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-base font-semibold">Configuração do sistema</h2>
              <p className="text-xs text-slate-600">Defina o <strong>limite do sistema (por fase)</strong> se quiser monitorar sobrecarga. Se deixar em branco, o app apenas calcula os totais.</p>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="text-sm font-medium">Limite do sistema por fase (A)</label>
                <input value={limite} onChange={(e)=>setLimite(e.target.value)} placeholder="Opcional" inputMode="decimal" className="mt-1 w-44 rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>
          </div>
        </section>

        {/* Totais e indicadores */}
        <section className="grid md:grid-cols-5 gap-3 mb-4">
          {PHASES.map((ph) => (
            <div
              key={ph}
              className={classNames(
                "rounded-2xl border p-4 shadow-sm",
                limitActive && totals[ph] > limitA ? "bg-red-50 border-red-300" : "bg-white"
              )}
              title={limitActive ? `Fase ${ph}: ${fmt(totals[ph])} A (${Math.round((totals[ph]/limitA)*100)}% do limite)` : `Fase ${ph}: ${fmt(totals[ph])} A`}
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">Fase {ph}</h2>
                <span className="text-xs text-slate-500">Total</span>
              </div>
              <div className="mt-2 text-3xl font-bold tabular-nums">{fmt(totals[ph])} A</div>
              {limitActive && (
                <div className="mt-1 text-xs">
                  Limite: {fmt(limitA)} A {totals[ph] > limitA && <span className="ml-1 text-red-600 font-semibold">(excedido)</span>}
                </div>
              )}
              <div className="mt-3 h-2 w-full rounded bg-slate-100 overflow-hidden">
                <div
                  className={classNames(
                    "h-full rounded",
                    limitActive && totals[ph] > limitA
                      ? "bg-red-600/80"
                      : (ph === "R" && "bg-red-500/80") ||
                        (ph === "S" && "bg-amber-500/80") ||
                        (ph === "T" && "bg-emerald-500/80")
                  )}
                  style={{ width: `${(limitActive ? Math.min(totals[ph] / limitA, 1) : (totals[ph] / maxTotal)) * 100}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-600">
                {limitActive ? (
                  <>Uso: {limitA > 0 ? Math.round((totals[ph] / limitA) * 100) : 0}% do limite</>
                ) : (
                  <>Participação: {totalSum > 0 ? Math.round((totals[ph] / totalSum) * 100) : 0}% do total</>
                )}
              </div>
            </div>
          ))}

          {/* Cartão do Sistema */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Sistema</h2>
              <span className="text-xs text-slate-500">Limite por fase</span>
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums">{limitActive ? fmt(limitA) + " A" : "—"}</div>
            <p className="mt-2 text-xs text-slate-600">Carga total nas fases: {fmt(totals.R + totals.S + totals.T)} A</p>
            {!limitActive && <p className="mt-1 text-xs text-slate-400">Defina acima para monitorar sobrecarga.</p>}
          </div>

          {/* Cartão Desequilíbrio */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Desequilíbrio</h2>
              <span className="text-xs text-slate-500">Δ / média</span>
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums">{imbalance.percent.toFixed(1)}%</div>
            <p className="mt-2 text-xs text-slate-600">Máx: {fmt(imbalance.max)} A · Mín: {fmt(imbalance.min)} A · Média: {fmt(imbalance.avg)} A</p>
          </div>
        </section>

        {/* Formulário de entrada */}
        <section className="rounded-2xl border bg-white p-4 shadow-sm mb-4">
          <h3 className="text-base font-semibold mb-3">Adicionar equipamento</h3>
          <div className="grid md:grid-cols-6 gap-3">
            <div className="md:col-span-2">
              <label className="text-sm font-medium">Nome (opcional)</label>
              <input value={nome} onChange={(e)=>setNome(e.target.value)} placeholder="Ex: AC 60k BTU #01" className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <select value={tipo} onChange={(e)=>setTipo(e.target.value as LoadType)} className="mt-1 w-full rounded-xl border px-3 py-2">
                <option value="monofasico">Monofásico</option>
                <option value="bifasico">Bifásico (fase-fase)</option>
                <option value="trifasico">Trifásico</option>
              </select>
            </div>
            {tipo === "monofasico" && (
              <div>
                <label className="text-sm font-medium">Fase</label>
                <select value={fase} onChange={(e)=>setFase(e.target.value as Phase)} className="mt-1 w-full rounded-xl border px-3 py-2">
                  {PHASES.map(p => (<option key={p} value={p}>{p}</option>))}
                </select>
              </div>
            )}
            {tipo === "bifasico" && (
              <div>
                <label className="text-sm font-medium">Par de fases</label>
                <select value={par} onChange={(e)=>setPar(e.target.value as BiPair)} className="mt-1 w-full rounded-xl border px-3 py-2">
                  <option value="RS">RS</option>
                  <option value="ST">ST</option>
                  <option value="RT">RT</option>
                </select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium">Corrente (A)</label>
              <input value={corrente} onChange={(e)=>setCorrente(e.target.value)} placeholder="Ex: 30" inputMode="decimal" className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
          </div>

          {/* Recomendações */}
          <div className="mt-3 rounded-xl border p-3 bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold">Sugestão de alocação</div>
              <div className="text-xs text-slate-500">com base no desequilíbrio atual</div>
            </div>
            <div className="mt-2 text-sm">
              {!recommendation && <span className="text-slate-500">Informe a corrente (A) para ver a sugestão.</span>}
              {recommendation && (
                <div className="flex flex-wrap items-baseline gap-2">
                  {recommendation.tipo === 'monofasico' && (<>
                    <span>Monofásico: alocar na fase</span>
                    <span className="inline-flex items-center rounded-lg bg-emerald-600 text-white px-2 py-0.5 font-semibold">{recommendation.best.target as any}</span>
                  </>)}
                  {recommendation.tipo === 'bifasico' && (<>
                    <span>Bifásico: alocar no par</span>
                    <span className="inline-flex items-center rounded-lg bg-emerald-600 text-white px-2 py-0.5 font-semibold">{recommendation.best.target as any}</span>
                  </>)}
                  {recommendation.tipo === 'trifasico' && (<>
                    <span>Trifásico: adiciona igualmente em</span>
                    <span className="inline-flex items-center rounded-lg bg-slate-800 text-white px-2 py-0.5 font-semibold">R,S,T</span>
                  </>)}
                  <span className="text-xs text-slate-500">Δ após adicionar: {recommendation.best.proj.d.percent.toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Botões de ação */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={addLoad} className="rounded-xl px-4 py-2 bg-slate-900 text-white hover:bg-slate-800">Adicionar</button>
            <span className="text-xs text-slate-500">ou</span>
            <button disabled={!recommendation} onClick={applyRecommendation} className="rounded-xl px-4 py-2 border hover:bg-slate-50 disabled:opacity-50">Adicionar (melhor opção)</button>

            <div className="ml-2 flex items-center gap-2">
              <input id="autoClear" type="checkbox" checked={autoClear} onChange={(e)=>setAutoClear(e.target.checked)} className="h-4 w-4" />
              <label htmlFor="autoClear" className="text-sm">Limpar campos após adicionar</label>
            </div>

            <button onClick={copyTable} className="rounded-xl px-4 py-2 border hover:bg-slate-50">Copiar tabela</button>
            <button onClick={triggerImport} className="rounded-xl px-4 py-2 border hover:bg-slate-50">Importar CSV</button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            <button onClick={clearAll} className="rounded-xl px-4 py-2 border hover:bg-slate-50">Limpar tudo</button>

            <div className="text-xs text-slate-600 ml-auto">Dica: Bifásico (fase-fase) soma a mesma corrente em ambas as fases selecionadas. Trifásico soma em R, S e T igualmente.</div>
          </div>
        </section>

        {/* Tabela de equipamentos */}
        <section className="rounded-2xl border bg-white p-2 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left border-b bg-slate-50">
                  <th className="py-2 px-3">Equipamento</th>
                  <th className="py-2 px-3">Tipo</th>
                  <th className="py-2 px-3">Fase(s)</th>
                  <th className="py-2 px-3">Corrente (A)</th>
                  <th className="py-2 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loads.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">Nenhum equipamento adicionado.</td>
                  </tr>
                )}
                {loads.map((l) => (
                  <tr key={l.id} className="border-b last:border-b-0">
                    <td className="py-2 px-3 font-medium">{l.nome}</td>
                    <td className="py-2 px-3">
                      {l.tipo === "monofasico" && "Monofásico"}
                      {l.tipo === "bifasico" && "Bifásico"}
                      {l.tipo === "trifasico" && "Trifásico"}
                    </td>
                    <td className="py-2 px-3">
                      {l.tipo === "monofasico" && l.fase}
                      {l.tipo === "bifasico" && l.par}
                      {l.tipo === "trifasico" && "R,S,T"}
                    </td>
                    <td className="py-2 px-3 tabular-nums">{fmt(l.corrente)}</td>
                    <td className="py-2 px-3 text-right">
                      <button onClick={()=>removeLoad(l.id)} className="rounded-lg px-3 py-1 border hover:bg-red-50 hover:border-red-300">Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="mt-6 text-xs text-slate-500">
          <p>⚠️ Observação: Para cargas bifásicas (fase-fase), a corrente informada é a corrente de linha e <strong>flui por ambos os condutores</strong> das fases selecionadas. O aplicativo soma essa corrente integralmente em cada fase envolvida. Para cargas trifásicas, a corrente é somada igualmente em R, S e T.</p>
        </footer>
      </div>
    </div>
  );
}
