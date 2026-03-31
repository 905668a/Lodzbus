import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ExternalLink, Search, Trash2 } from "lucide-react";

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
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const PAGE_SIZE = 9;

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



  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((item) => {
      const matchesText =
        q.length === 0 ||
        item.url.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.note.toLowerCase().includes(q);
      return matchesText;
    });
  }, [links, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const paginated = useMemo(() => {
    const start = (current - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, current]);

  return (
    <div className="te-amo-container">
      <div className="te-amo-header">
        <button className="back-button-te-amo" onClick={onBack}>
          <ArrowLeft size={22} /> Volver
        </button>
        <h1>📒 Notas</h1>
        <div className="header-spacer" />
      </div>

      <div className="gallery-section">
        <div className="gallery-upload">
          <button 
            className="add-button" 
            onClick={() => setShowAddForm(!showAddForm)}
            style={{ width: "100%", justifyContent: "center", gap: "0.5rem" }}
          >
            <ChevronDown size={20} style={{ transform: showAddForm ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} /> 
            Añadir enlace
          </button>

          {showAddForm && (
            <>
              <div className="url-input-wrapper">
                <input
                  className="url-input"
                  type="text"
                  placeholder="https://..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addLink()}
                  autoFocus
                />
                <button className="add-button" onClick={() => void addLink()}>
                  Guardar
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
              </div>

              <textarea
                className="url-input"
                rows={3}
                placeholder="Nota (opcional)"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
              />
            </>
          )}

          {error && <p className="error-message">{error}</p>}
          {syncMessage && <p className="help-text">{syncMessage}</p>}
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
