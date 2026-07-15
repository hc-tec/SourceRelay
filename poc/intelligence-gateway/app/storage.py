from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import (
    ChangeType,
    CapabilityAction,
    DraftCapabilityRecord,
    DraftCapabilityRequest,
    DraftStatus,
    DocumentRecord,
    JobRecord,
    JobStatus,
    ObservationRecord,
    PersistenceSummary,
    SearchRequest,
    SearchResponse,
    SearchRunRecord,
)
from .normalization import canonicalize_url, item_content_hash, item_identity


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


class GatewayStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self._lock = threading.Lock()

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    source TEXT NOT NULL,
                    status TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    response_json TEXT,
                    error_json TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT
                );
                CREATE TABLE IF NOT EXISTS connector_bindings (
                    source TEXT NOT NULL,
                    binding_key TEXT NOT NULL,
                    remote_id TEXT NOT NULL,
                    remote_name TEXT,
                    metadata_json TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (source, binding_key)
                );
                CREATE TABLE IF NOT EXISTS search_runs (
                    run_id TEXT PRIMARY KEY,
                    job_id TEXT,
                    source TEXT NOT NULL,
                    query TEXT NOT NULL,
                    site TEXT,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    duration_ms INTEGER,
                    item_count INTEGER NOT NULL DEFAULT 0,
                    new_count INTEGER NOT NULL DEFAULT 0,
                    changed_count INTEGER NOT NULL DEFAULT 0,
                    seen_count INTEGER NOT NULL DEFAULT 0,
                    warnings_json TEXT NOT NULL DEFAULT '[]',
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS documents (
                    document_id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    identity_key TEXT NOT NULL,
                    cross_source_fingerprint TEXT NOT NULL,
                    canonical_url TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    author TEXT NOT NULL DEFAULT '',
                    author_url TEXT NOT NULL DEFAULT '',
                    published_at TEXT,
                    published_text TEXT NOT NULL DEFAULT '',
                    snippet TEXT NOT NULL DEFAULT '',
                    metrics_json TEXT NOT NULL DEFAULT '{}',
                    content_type TEXT NOT NULL DEFAULT 'unknown',
                    promoted INTEGER NOT NULL DEFAULT 0,
                    collector TEXT NOT NULL DEFAULT '',
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    observation_count INTEGER NOT NULL DEFAULT 1,
                    current_content_hash TEXT NOT NULL,
                    latest_payload_json TEXT NOT NULL,
                    UNIQUE(source, identity_key)
                );
                CREATE TABLE IF NOT EXISTS observations (
                    observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    document_id TEXT NOT NULL,
                    rank INTEGER NOT NULL,
                    observed_at TEXT NOT NULL,
                    change_type TEXT NOT NULL,
                    content_hash TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    UNIQUE(run_id, document_id),
                    FOREIGN KEY(run_id) REFERENCES search_runs(run_id),
                    FOREIGN KEY(document_id) REFERENCES documents(document_id)
                );
                CREATE INDEX IF NOT EXISTS idx_search_runs_started ON search_runs(started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_search_runs_source_query ON search_runs(source, query);
                CREATE INDEX IF NOT EXISTS idx_documents_last_seen ON documents(last_seen_at DESC);
                CREATE INDEX IF NOT EXISTS idx_documents_source_last_seen ON documents(source, last_seen_at DESC);
                CREATE INDEX IF NOT EXISTS idx_documents_cross_fingerprint ON documents(cross_source_fingerprint);
                CREATE INDEX IF NOT EXISTS idx_observations_observed ON observations(observed_at DESC);
                CREATE INDEX IF NOT EXISTS idx_observations_change ON observations(change_type, observed_at DESC);
                CREATE TABLE IF NOT EXISTS capability_drafts (
                    draft_id TEXT PRIMARY KEY,
                    platform TEXT NOT NULL,
                    action TEXT NOT NULL,
                    start_url TEXT NOT NULL,
                    sample_query TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    inspection_json TEXT,
                    recipe_json TEXT,
                    validation_json TEXT,
                    promoted_capability_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_capability_drafts_updated
                    ON capability_drafts(updated_at DESC);
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def create_job(self, kind: str, source: str, request: dict[str, Any]) -> JobRecord:
        job_id = str(uuid.uuid4())
        created_at = _now_iso()
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO jobs(job_id, kind, source, status, request_json, created_at) VALUES(?,?,?,?,?,?)",
                (job_id, kind, source, JobStatus.QUEUED.value, _json_dump(request), created_at),
            )
        return self.get_job(job_id)

    def mark_job_running(self, job_id: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE jobs SET status=?, started_at=? WHERE job_id=?",
                (JobStatus.RUNNING.value, _now_iso(), job_id),
            )

    def complete_job(self, job_id: str, response: dict[str, Any]) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE jobs SET status=?, response_json=?, finished_at=? WHERE job_id=?",
                (JobStatus.SUCCESS.value, _json_dump(response), _now_iso(), job_id),
            )

    def fail_job(self, job_id: str, error: dict[str, Any]) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE jobs SET status=?, error_json=?, finished_at=? WHERE job_id=?",
                (JobStatus.FAILED.value, _json_dump(error), _now_iso(), job_id),
            )

    def get_job(self, job_id: str) -> JobRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        return JobRecord(
            job_id=row["job_id"],
            kind=row["kind"],
            source=row["source"],
            status=row["status"],
            request=json.loads(row["request_json"]),
            response=json.loads(row["response_json"]) if row["response_json"] else None,
            error=json.loads(row["error_json"]) if row["error_json"] else None,
            created_at=row["created_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
        )

    def get_binding(self, source: str, binding_key: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM connector_bindings WHERE source=? AND binding_key=?",
                (source, binding_key),
            ).fetchone()
        if row is None:
            return None
        return {
            "remote_id": row["remote_id"],
            "remote_name": row["remote_name"],
            "metadata": json.loads(row["metadata_json"] or "{}"),
            "updated_at": row["updated_at"],
        }

    def set_binding(
        self,
        source: str,
        binding_key: str,
        remote_id: str,
        remote_name: str,
        metadata: dict[str, Any],
    ) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO connector_bindings(source, binding_key, remote_id, remote_name, metadata_json, updated_at)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(source, binding_key) DO UPDATE SET
                    remote_id=excluded.remote_id,
                    remote_name=excluded.remote_name,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (source, binding_key, remote_id, remote_name, _json_dump(metadata), _now_iso()),
            )

    def create_search_run(self, request: SearchRequest, job_id: str | None = None) -> str:
        run_id = str(uuid.uuid4())
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO search_runs(run_id, job_id, source, query, site, status, started_at)
                VALUES(?,?,?,?,?,?,?)
                """,
                (
                    run_id,
                    job_id,
                    request.source.value,
                    request.query,
                    request.site,
                    "running",
                    _now_iso(),
                ),
            )
        return run_id

    def fail_search_run(self, run_id: str, status: str, error: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "UPDATE search_runs SET status=?, error=?, finished_at=? WHERE run_id=?",
                (status, error, _now_iso(), run_id),
            )

    def persist_search_response(
        self, run_id: str, response: SearchResponse
    ) -> PersistenceSummary:
        observed_at = response.fetched_at.isoformat()
        counts = {ChangeType.NEW: 0, ChangeType.CHANGED: 0, ChangeType.SEEN: 0}
        with self._lock, self._connect() as connection:
            for item in response.items:
                item.url = canonicalize_url(item.url)
                item.author_url = canonicalize_url(item.author_url)
                document_id, identity_key, cross_fingerprint = item_identity(item)
                content_hash = item_content_hash(item)
                payload = item.model_dump(mode="json")
                payload_json = _json_dump(payload)
                existing = connection.execute(
                    "SELECT current_content_hash FROM documents WHERE document_id=?",
                    (document_id,),
                ).fetchone()
                if existing is None:
                    change_type = ChangeType.NEW
                    connection.execute(
                        """
                        INSERT INTO documents(
                            document_id, source, identity_key, cross_source_fingerprint,
                            canonical_url, title, author, author_url, published_at,
                            published_text, snippet, metrics_json, content_type, promoted,
                            collector, first_seen_at, last_seen_at, observation_count,
                            current_content_hash, latest_payload_json
                        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            document_id,
                            item.source.value,
                            identity_key,
                            cross_fingerprint,
                            item.url,
                            item.title,
                            item.author,
                            item.author_url,
                            item.published_at.isoformat() if item.published_at else None,
                            item.published_text,
                            item.snippet,
                            _json_dump(item.metrics),
                            item.content_type,
                            int(item.promoted),
                            item.collector,
                            observed_at,
                            observed_at,
                            1,
                            content_hash,
                            payload_json,
                        ),
                    )
                else:
                    change_type = (
                        ChangeType.SEEN
                        if existing["current_content_hash"] == content_hash
                        else ChangeType.CHANGED
                    )
                    connection.execute(
                        """
                        UPDATE documents SET
                            cross_source_fingerprint=?, canonical_url=?, title=?, author=?,
                            author_url=?, published_at=?, published_text=?, snippet=?,
                            metrics_json=?, content_type=?, promoted=?, collector=?,
                            last_seen_at=?, observation_count=observation_count+1,
                            current_content_hash=?, latest_payload_json=?
                        WHERE document_id=?
                        """,
                        (
                            cross_fingerprint,
                            item.url,
                            item.title,
                            item.author,
                            item.author_url,
                            item.published_at.isoformat() if item.published_at else None,
                            item.published_text,
                            item.snippet,
                            _json_dump(item.metrics),
                            item.content_type,
                            int(item.promoted),
                            item.collector,
                            observed_at,
                            content_hash,
                            payload_json,
                            document_id,
                        ),
                    )
                connection.execute(
                    """
                    INSERT INTO observations(
                        run_id, document_id, rank, observed_at, change_type, content_hash, payload_json
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        run_id,
                        document_id,
                        item.rank,
                        observed_at,
                        change_type.value,
                        content_hash,
                        payload_json,
                    ),
                )
                counts[change_type] += 1

            finished_at = _now_iso()
            connection.execute(
                """
                UPDATE search_runs SET
                    status=?, finished_at=?, duration_ms=?, item_count=?,
                    new_count=?, changed_count=?, seen_count=?, warnings_json=?, error=?
                WHERE run_id=?
                """,
                (
                    response.status.value,
                    finished_at,
                    response.duration_ms,
                    response.item_count,
                    counts[ChangeType.NEW],
                    counts[ChangeType.CHANGED],
                    counts[ChangeType.SEEN],
                    _json_dump(response.warnings),
                    response.error,
                    run_id,
                ),
            )
        return PersistenceSummary(
            run_id=run_id,
            new_count=counts[ChangeType.NEW],
            changed_count=counts[ChangeType.CHANGED],
            seen_count=counts[ChangeType.SEEN],
        )

    @staticmethod
    def _document_from_row(row: sqlite3.Row) -> DocumentRecord:
        return DocumentRecord(
            document_id=row["document_id"],
            source=row["source"],
            identity_key=row["identity_key"],
            cross_source_fingerprint=row["cross_source_fingerprint"],
            canonical_url=row["canonical_url"],
            title=row["title"],
            author=row["author"],
            author_url=row["author_url"],
            published_at=row["published_at"],
            published_text=row["published_text"],
            snippet=row["snippet"],
            metrics=json.loads(row["metrics_json"]),
            content_type=row["content_type"],
            promoted=bool(row["promoted"]),
            collector=row["collector"],
            first_seen_at=row["first_seen_at"],
            last_seen_at=row["last_seen_at"],
            observation_count=row["observation_count"],
            current_content_hash=row["current_content_hash"],
            latest_payload=json.loads(row["latest_payload_json"]),
        )

    def get_document(self, document_id: str) -> DocumentRecord:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM documents WHERE document_id=?", (document_id,)
            ).fetchone()
        if row is None:
            raise KeyError(document_id)
        return self._document_from_row(row)

    def list_documents(
        self,
        source: str | None = None,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[DocumentRecord]:
        clauses: list[str] = []
        parameters: list[Any] = []
        if source:
            clauses.append("source=?")
            parameters.append(source)
        if query:
            clauses.append("(title LIKE ? OR author LIKE ? OR snippet LIKE ? OR canonical_url LIKE ?)")
            pattern = f"%{query}%"
            parameters.extend([pattern, pattern, pattern, pattern])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.extend([limit, offset])
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM documents {where} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?",
                parameters,
            ).fetchall()
        return [self._document_from_row(row) for row in rows]

    def list_documents_by_fingerprint(
        self, cross_source_fingerprint: str
    ) -> list[DocumentRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM documents WHERE cross_source_fingerprint=?
                ORDER BY last_seen_at DESC
                """,
                (cross_source_fingerprint,),
            ).fetchall()
        return [self._document_from_row(row) for row in rows]

    def list_clusters(self, min_documents: int = 2, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT
                    cross_source_fingerprint,
                    COUNT(*) AS document_count,
                    COUNT(DISTINCT source) AS source_count,
                    GROUP_CONCAT(DISTINCT source) AS sources,
                    MAX(last_seen_at) AS last_seen_at
                FROM documents
                GROUP BY cross_source_fingerprint
                HAVING COUNT(*) >= ?
                ORDER BY last_seen_at DESC
                LIMIT ?
                """,
                (min_documents, limit),
            ).fetchall()
        return [
            {
                "cross_source_fingerprint": row["cross_source_fingerprint"],
                "document_count": row["document_count"],
                "source_count": row["source_count"],
                "sources": sorted((row["sources"] or "").split(",")),
                "last_seen_at": row["last_seen_at"],
            }
            for row in rows
        ]

    @staticmethod
    def _observation_from_row(row: sqlite3.Row) -> ObservationRecord:
        return ObservationRecord(
            observation_id=row["observation_id"],
            run_id=row["run_id"],
            document_id=row["document_id"],
            rank=row["rank"],
            observed_at=row["observed_at"],
            change_type=row["change_type"],
            content_hash=row["content_hash"],
            payload=json.loads(row["payload_json"]),
        )

    def list_observations(
        self,
        document_id: str | None = None,
        source: str | None = None,
        change_type: str | None = None,
        since: datetime | None = None,
        limit: int = 100,
    ) -> list[ObservationRecord]:
        clauses: list[str] = []
        parameters: list[Any] = []
        if document_id:
            clauses.append("o.document_id=?")
            parameters.append(document_id)
        if source:
            clauses.append("d.source=?")
            parameters.append(source)
        if change_type:
            clauses.append("o.change_type=?")
            parameters.append(change_type)
        if since:
            clauses.append("o.observed_at>=?")
            parameters.append(since.isoformat())
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.append(limit)
        with self._connect() as connection:
            rows = connection.execute(
                f"""
                SELECT o.* FROM observations o
                JOIN documents d ON d.document_id=o.document_id
                {where}
                ORDER BY o.observed_at DESC, o.observation_id DESC LIMIT ?
                """,
                parameters,
            ).fetchall()
        return [self._observation_from_row(row) for row in rows]

    @staticmethod
    def _run_from_row(row: sqlite3.Row) -> SearchRunRecord:
        return SearchRunRecord(
            run_id=row["run_id"],
            job_id=row["job_id"],
            source=row["source"],
            query=row["query"],
            site=row["site"],
            status=row["status"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            duration_ms=row["duration_ms"],
            item_count=row["item_count"],
            new_count=row["new_count"],
            changed_count=row["changed_count"],
            seen_count=row["seen_count"],
            warnings=json.loads(row["warnings_json"]),
            error=row["error"],
        )

    def get_search_run(self, run_id: str) -> SearchRunRecord:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM search_runs WHERE run_id=?", (run_id,)
            ).fetchone()
        if row is None:
            raise KeyError(run_id)
        return self._run_from_row(row)

    def list_search_runs(
        self, source: str | None = None, query: str | None = None, limit: int = 50
    ) -> list[SearchRunRecord]:
        clauses: list[str] = []
        parameters: list[Any] = []
        if source:
            clauses.append("source=?")
            parameters.append(source)
        if query:
            clauses.append("query LIKE ?")
            parameters.append(f"%{query}%")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.append(limit)
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM search_runs {where} ORDER BY started_at DESC LIMIT ?",
                parameters,
            ).fetchall()
        return [self._run_from_row(row) for row in rows]

    def library_stats(self) -> dict[str, Any]:
        with self._connect() as connection:
            document_count = connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            observation_count = connection.execute(
                "SELECT COUNT(*) FROM observations"
            ).fetchone()[0]
            run_count = connection.execute("SELECT COUNT(*) FROM search_runs").fetchone()[0]
            by_source = {
                row["source"]: row["count"]
                for row in connection.execute(
                    "SELECT source, COUNT(*) AS count FROM documents GROUP BY source"
                ).fetchall()
            }
            by_change = {
                row["change_type"]: row["count"]
                for row in connection.execute(
                    "SELECT change_type, COUNT(*) AS count FROM observations GROUP BY change_type"
                ).fetchall()
            }
        return {
            "document_count": document_count,
            "observation_count": observation_count,
            "search_run_count": run_count,
            "documents_by_source": by_source,
            "observations_by_change": by_change,
        }

    @staticmethod
    def _draft_from_row(row: sqlite3.Row) -> DraftCapabilityRecord:
        return DraftCapabilityRecord(
            draft_id=row["draft_id"],
            platform=row["platform"],
            action=CapabilityAction(row["action"]),
            start_url=row["start_url"],
            sample_query=row["sample_query"],
            description=row["description"],
            status=DraftStatus(row["status"]),
            inspection=json.loads(row["inspection_json"]) if row["inspection_json"] else None,
            recipe=json.loads(row["recipe_json"]) if row["recipe_json"] else None,
            validation=(
                json.loads(row["validation_json"]) if row["validation_json"] else None
            ),
            promoted_capability_id=row["promoted_capability_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_capability_draft(self, request: DraftCapabilityRequest) -> DraftCapabilityRecord:
        draft_id = str(uuid.uuid4())
        timestamp = _now_iso()
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO capability_drafts(
                    draft_id, platform, action, start_url, sample_query,
                    description, status, created_at, updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    draft_id,
                    request.platform,
                    request.action.value,
                    str(request.start_url),
                    request.sample_query,
                    request.description,
                    DraftStatus.PROPOSED.value,
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_capability_draft(draft_id)

    def get_capability_draft(self, draft_id: str) -> DraftCapabilityRecord:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM capability_drafts WHERE draft_id=?", (draft_id,)
            ).fetchone()
        if row is None:
            raise KeyError(draft_id)
        return self._draft_from_row(row)

    def list_capability_drafts(self, limit: int = 50) -> list[DraftCapabilityRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM capability_drafts ORDER BY updated_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._draft_from_row(row) for row in rows]

    def update_capability_draft(
        self,
        draft_id: str,
        *,
        status: DraftStatus,
        inspection: dict[str, Any] | None = None,
        recipe: dict[str, Any] | None = None,
        validation: dict[str, Any] | None = None,
        promoted_capability_id: str | None = None,
    ) -> DraftCapabilityRecord:
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE capability_drafts SET
                    status=?, inspection_json=COALESCE(?, inspection_json),
                    recipe_json=COALESCE(?, recipe_json),
                    validation_json=COALESCE(?, validation_json),
                    promoted_capability_id=COALESCE(?, promoted_capability_id),
                    updated_at=?
                WHERE draft_id=?
                """,
                (
                    status.value,
                    _json_dump(inspection) if inspection is not None else None,
                    _json_dump(recipe) if recipe is not None else None,
                    _json_dump(validation) if validation is not None else None,
                    promoted_capability_id,
                    _now_iso(),
                    draft_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(draft_id)
        return self.get_capability_draft(draft_id)
