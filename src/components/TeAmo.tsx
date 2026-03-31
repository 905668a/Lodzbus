import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, ImagePlus, Plus, Search, Trash2 } from "lucide-react";

interface TeAmoProps {
  onBack: () => void;
}

interface NotebookLink {
  id: string;
  url: string;
  sourceUrl?: string;
  title: string;
  note: string;
  domain: string;
  createdAt: string;
}

const STORAGE_KEY = "lodz-bus:notebook-links";
const LEGACY_EMBEDS_KEY = "lodz-bus:te-amo-embeds";
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const extractDomain = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "desconocido";
  }
};

const safeDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const isImageUrl = (value: string) => {
  const normalized = String(value || "").toLowerCase();
  return normalized.includes("/cached-images/") || /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i.test(normalized);
};

export default function TeAmo({ onBack }: TeAmoProps) {
  const [links, setLinks] = useState<NotebookLink[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [pageSize, setPageSize] = useState(9);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [importingPins, setImportingPins] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/app-state`);
        if (response.ok) {
          const payload = await response.json();
          if (Array.isArray(payload?.links)) {
            setLinks(payload.links);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload.links));
            return;
          }
        }
      } catch {
        // fallback to local storage below
      }

      try {
        const localRaw = localStorage.getItem(STORAGE_KEY);
        const parsed = localRaw ? JSON.parse(localRaw) : [];
        if (Array.isArray(parsed)) setLinks(parsed);
      } catch {
        // ignore malformed local storage
      }
    };

    void load();
  }, []);

  const persistLinks = async (nextLinks: NotebookLink[]) => {
    setLinks(nextLinks);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLinks));

    try {
      const response = await fetch(`${API_BASE}/api/app-state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: nextLinks }),
      });

      if (response.ok) {
        setSyncMessage("✅ Guardado en servidor. Disponible en móvil/iPad.");
      } else {
        setSyncMessage("⚠️ Guardado local, pero no se pudo sincronizar con servidor.");
      }
    } catch {
      setSyncMessage("⚠️ Guardado local, pero no se pudo sincronizar con servidor.");
    }
  };

  const addLink = async () => {
    setError("");
    const raw = urlInput.trim();
    if (!raw) {
      setError("Añade una URL primero.");
      return;
    }

    const normalized = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

    try {
      new URL(normalized);
    } catch {
      setError("URL inválida. Ejemplo: https://ejemplo.com");
      return;
    }

    if (links.some((item) => item.url === normalized)) {
      setError("Ese enlace ya existe.");
      return;
    }

    const next: NotebookLink = {
      id: crypto.randomUUID(),
      url: normalized,
      title: titleInput.trim() || extractDomain(normalized),
      note: noteInput.trim(),
      domain: extractDomain(normalized),
      createdAt: new Date().toISOString(),
    };

    const updated = [next, ...links];
    await persistLinks(updated);

    setUrlInput("");
    setTitleInput("");
    setNoteInput("");
  };

  const removeLink = async (id: string) => {
    const updated = links.filter((item) => item.id !== id);
    await persistLinks(updated);
  };

  const clearAll = async () => {
    await persistLinks([]);
  };

  const importPinterestFromLegacy = async () => {
    setImportingPins(true);
    setError("");
    setSyncMessage("");

    try {
      const rawLegacy = localStorage.getItem(LEGACY_EMBEDS_KEY);
      const parsed = rawLegacy ? JSON.parse(rawLegacy) : [];
      const pinterestUrls = Array.isArray(parsed)
        ? parsed
            .map((entry: unknown) => {
              const item = entry as { url?: string; type?: string };
              if (typeof item?.url !== "string") return null;
              const lowered = item.url.toLowerCase();
              if (item.type === "pinterest" || lowered.includes("pinterest.com") || lowered.includes("pin.it")) {
                return item.url;
              }
              return null;
            })
            .filter(Boolean) as string[]
        : [];

      const uniqueBoards = Array.from(new Set(pinterestUrls));
      if (uniqueBoards.length === 0) {
        setSyncMessage("No encontré links antiguos de Pinterest para importar.");
        return;
      }

      const imageCandidates: string[] = [];
      for (const boardUrl of uniqueBoards) {
        try {
          const response = await fetch(`${API_BASE}/api/pinterest-board-images?url=${encodeURIComponent(boardUrl)}&limit=60`);
          if (!response.ok) continue;
          const payload = await response.json();
          const images = Array.isArray(payload?.images) ? payload.images : [];
          for (const url of images) {
            if (typeof url === "string") imageCandidates.push(url);
          }
        } catch {
          // continue with next board
        }
      }

      const dedupedImages = Array.from(new Set(imageCandidates));
      if (dedupedImages.length === 0) {
        setSyncMessage("No pude recuperar imágenes del contenido antiguo.");
        return;
      }

      const existing = new Set(links.map((l) => l.url));
      const imported: NotebookLink[] = [];

      for (let i = 0; i < dedupedImages.length; i++) {
        const sourceUrl = dedupedImages[i];
        try {
          const cachedResponse = await fetch(`${API_BASE}/api/cache-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: sourceUrl }),
          });

          if (!cachedResponse.ok) continue;
          const cached = await cachedResponse.json();
          const cachedUrl = typeof cached?.cachedUrl === "string" ? cached.cachedUrl : "";
          if (!cachedUrl || existing.has(cachedUrl)) continue;

          existing.add(cachedUrl);
          imported.push({
            id: crypto.randomUUID(),
            url: cachedUrl,
            sourceUrl,
            title: `Pinterest ${i + 1}`,
            note: "Importada y guardada en servidor",
            domain: extractDomain(cachedUrl),
            createdAt: new Date().toISOString(),
          });
        } catch {
          // continue importing
        }
      }

      if (imported.length === 0) {
        setSyncMessage("No había fotos nuevas para guardar (o hubo bloqueos de descarga).");
        return;
      }

      await persistLinks([...imported, ...links]);
      setSyncMessage(`✅ Importadas y guardadas ${imported.length} fotos de Pinterest.`);
    } catch {
      setError("No se pudo importar Pinterest ahora mismo.");
    } finally {
      setImportingPins(false);
    }
  };

  const domains = useMemo(
    () => ["all", ...Array.from(new Set(links.map((item) => item.domain))).sort((a, b) => a.localeCompare(b))],
    [links]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((item) => {
      const matchesDomain = domainFilter === "all" || item.domain === domainFilter;
      const matchesText =
        q.length === 0 ||
        item.url.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.note.toLowerCase().includes(q);
      return matchesDomain && matchesText;
    });
  }, [links, search, domainFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, domainFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (current - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, current, pageSize]);

  return (
    <div className="te-amo-container">
      <div className="te-amo-header">
        <button className="back-button-te-amo" onClick={onBack}>
          <ArrowLeft size={22} /> Volver
        </button>
        <h1>📒 Tablero persistente</h1>
        <div className="header-spacer" />
      </div>

      <div className="gallery-section">
        <div className="gallery-upload">
          <div className="url-input-wrapper">
            <input
              className="url-input"
              type="text"
              placeholder="https://..."
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addLink()}
            />
            <button className="add-button" onClick={() => void addLink()}>
              <Plus size={20} /> Añadir
            </button>
          </div>

          <div className="url-input-wrapper">
            <input
              className="url-input"
              type="text"
              placeholder="Título (opcional)"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
            />
            <button className="header-btn" onClick={() => void importPinterestFromLegacy()} disabled={importingPins}>
              <ImagePlus size={16} /> {importingPins ? "Guardando..." : "Guardar Pinterest antiguo"}
            </button>
          </div>

          <textarea
            className="url-input"
            rows={3}
            placeholder="Nota (opcional)"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
          />

          {error && <p className="error-message">{error}</p>}
          {syncMessage && <p className="help-text">{syncMessage}</p>}

          {links.length > 0 && (
            <div className="gallery-actions">
              <button className="clear-gallery-btn" onClick={() => void clearAll()}>
                Limpiar todo
              </button>
            </div>
          )}
        </div>

        <div className="gallery-filters">
          <div className="filter-chips" role="tablist" aria-label="Filtros">
            <div className="url-input-wrapper" style={{ width: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                <Search size={16} />
                <input
                  className="gallery-search-input"
                  type="text"
                  placeholder="Buscar"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select className="gallery-search-input" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)}>
                {domains.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain === "all" ? "Todos los dominios" : domain}
                  </option>
                ))}
              </select>
              <select className="gallery-search-input" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                <option value={6}>6/página</option>
                <option value={9}>9/página</option>
                <option value={12}>12/página</option>
                <option value={24}>24/página</option>
              </select>
            </div>
          </div>
        </div>

        {paginated.length > 0 ? (
          <div className="gallery-wrapper">
            <div className="gallery-container">
              {paginated.map((item) => (
                <article key={item.id} className="gallery-item">
                  <div className="embed-content" style={{ padding: "1rem", gap: "0.6rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="embed-type-badge" style={{ position: "static" }}>{item.domain}</span>
                      <button className="delete-button" style={{ position: "static", padding: "0.4rem" }} onClick={() => void removeLink(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <h3 style={{ color: "#fff", lineHeight: 1.25 }}>{item.title}</h3>

                    {isImageUrl(item.url) && (
                      <img src={item.url} alt={item.title} style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(59,130,246,0.25)" }} loading="lazy" />
                    )}

                    <p className="substack-url" style={{ maxWidth: "100%" }}>{item.url}</p>
                    {item.sourceUrl && <p className="substack-url" style={{ maxWidth: "100%" }}>Origen: {item.sourceUrl}</p>}
                    {item.note && <p style={{ color: "#cbd5e1", fontSize: "0.88rem" }}>{item.note}</p>}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>{safeDate(item.createdAt)}</span>
                      <a className="embed-link-button" href={item.url} target="_blank" rel="noreferrer">
                        Abrir <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="gallery-empty">
            {links.length === 0 ? (
              <>
                <p>Tu tablero está vacío</p>
                <p>Añade enlaces y se guardarán también en servidor.</p>
              </>
            ) : (
              <>
                <p>Sin resultados</p>
                <p>Prueba otro filtro o búsqueda.</p>
              </>
            )}
          </div>
        )}

        <div className="gallery-stats" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <p>
            Mostrando <span>{paginated.length}</span> de <span>{filtered.length}</span> (total: <span>{links.length}</span>)
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="header-btn" disabled={current <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Anterior</button>
            <button className="header-btn" disabled={current >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Siguiente →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
