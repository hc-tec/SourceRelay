from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, HttpUrl, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SourceName(StrEnum):
    BILIBILI = "bilibili"
    XIAOHONGSHU = "xiaohongshu"
    WEB = "web"


class ResultStatus(StrEnum):
    SUCCESS = "success"
    NO_RESULTS = "no_results"
    AUTHENTICATION_REQUIRED = "authentication_required"
    SOURCE_UNAVAILABLE = "source_unavailable"
    MISCONFIGURED = "misconfigured"
    ERROR = "error"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class ChangeType(StrEnum):
    NEW = "new"
    CHANGED = "changed"
    SEEN = "seen"


class CapabilityAction(StrEnum):
    KEYWORD_SEARCH = "keyword_search"
    ARTICLE_EXTRACT = "article_extract"
    DETAIL_FETCH = "detail_fetch"


class CapabilityStatus(StrEnum):
    DECLARED_UNVERIFIED = "declared_unverified"
    VERIFIED = "verified"
    DEGRADED = "degraded"
    AUTHENTICATION_REQUIRED = "authentication_required"
    BLOCKED = "blocked"
    RETIRED = "retired"


class DraftStatus(StrEnum):
    PROPOSED = "proposed"
    INSPECTED = "inspected"
    VALIDATED = "validated"
    FAILED = "failed"
    PROMOTED = "promoted"


class AuthenticationMode(StrEnum):
    NONE = "none"
    LOCAL_API_KEY = "local_api_key"
    MANUAL_PERSISTENT_PROFILE = "manual_persistent_profile"


class AuthenticationRequirement(BaseModel):
    required: bool = False
    mode: AuthenticationMode = AuthenticationMode.NONE
    profile_id: str | None = None


class CapabilityReliability(BaseModel):
    last_verification_status: ResultStatus | None = None
    consecutive_failures: int = Field(default=0, ge=0)
    failure_threshold: int = Field(default=3, ge=1, le=20)
    last_attempt_at: datetime | None = None
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    blocked_at: datetime | None = None
    last_error: str | None = None
    last_warnings: list[str] = Field(default_factory=list)


class CapabilityManifest(BaseModel):
    capability_id: str
    version: str
    platform: str
    action: CapabilityAction
    status: CapabilityStatus
    executor: str
    adapter: str
    source: SourceName | None = None
    authentication: AuthenticationRequirement = Field(default_factory=AuthenticationRequirement)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: str
    scope: dict[str, Any] = Field(default_factory=dict)
    fallback_ids: list[str] = Field(default_factory=list)
    fallback_site: str | None = None
    verification_input: dict[str, Any] | None = None
    recipe: dict[str, Any] | None = None
    last_verified_at: datetime | None = None
    reliability: CapabilityReliability = Field(default_factory=CapabilityReliability)
    license: str = ""
    warnings: list[str] = Field(default_factory=list)


class TaskPlanRequest(BaseModel):
    platform: str = Field(min_length=1, max_length=100)
    action: CapabilityAction
    input: dict[str, Any] = Field(default_factory=dict)
    allow_fallback: bool = True

    @field_validator("platform")
    @classmethod
    def clean_platform(cls, value: str) -> str:
        return value.strip().lower()


class TaskPlanResponse(BaseModel):
    available: bool
    requested_platform: str
    requested_action: CapabilityAction
    selected_capability: CapabilityManifest | None = None
    fallback_capabilities: list[CapabilityManifest] = Field(default_factory=list)
    effective_input: dict[str, Any] = Field(default_factory=dict)
    degraded: bool = False
    warnings: list[str] = Field(default_factory=list)


class TaskExecutionOptions(BaseModel):
    allow_fallback: bool = True
    fallback_on_no_results: bool = True
    persistence: Literal["none", "result_only"] = "result_only"


class TaskExecutionRequest(BaseModel):
    platform: str = Field(min_length=1, max_length=100)
    action: CapabilityAction
    input: dict[str, Any] = Field(default_factory=dict)
    options: TaskExecutionOptions = Field(default_factory=TaskExecutionOptions)

    @field_validator("platform")
    @classmethod
    def clean_platform(cls, value: str) -> str:
        return value.strip().lower()


class TaskExecutionResponse(BaseModel):
    task_id: str
    ok: bool
    status: ResultStatus
    requested_platform: str
    requested_action: CapabilityAction
    executed_capability_id: str
    executor: str
    degraded: bool = False
    attempted_capabilities: list[str] = Field(default_factory=list)
    scope: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class CapabilityCheckResponse(BaseModel):
    capability_id: str
    ready: bool
    status: ResultStatus
    checked_at: datetime = Field(default_factory=utc_now)
    details: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class CapabilityReliabilityResponse(BaseModel):
    capability_id: str
    capability_status: CapabilityStatus
    planner_eligible: bool
    runtime_mutable: bool
    reliability: CapabilityReliability


class ProfileStatus(BaseModel):
    profile_id: str
    platform: str
    executor: str
    ready: bool
    authentication_state: str
    checked_at: datetime = Field(default_factory=utc_now)
    warnings: list[str] = Field(default_factory=list)


class DraftCapabilityRequest(BaseModel):
    platform: str = Field(min_length=1, max_length=100)
    action: Literal[CapabilityAction.KEYWORD_SEARCH] = CapabilityAction.KEYWORD_SEARCH
    start_url: HttpUrl
    sample_query: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)

    @field_validator("platform", "sample_query")
    @classmethod
    def clean_draft_text(cls, value: str) -> str:
        return " ".join(value.split())


class DraftCapabilityRecord(BaseModel):
    draft_id: str
    platform: str
    action: CapabilityAction
    start_url: str
    sample_query: str
    description: str = ""
    status: DraftStatus
    inspection: dict[str, Any] | None = None
    recipe: dict[str, Any] | None = None
    validation: dict[str, Any] | None = None
    promoted_capability_id: str | None = None
    created_at: datetime
    updated_at: datetime


class DraftValidationResponse(BaseModel):
    draft_id: str
    passed: bool
    status: DraftStatus
    recipe: dict[str, Any] | None = None
    evidence: dict[str, Any] = Field(default_factory=dict)
    issues: list[str] = Field(default_factory=list)


class PersistenceSummary(BaseModel):
    run_id: str
    new_count: int = Field(ge=0)
    changed_count: int = Field(ge=0)
    seen_count: int = Field(ge=0)


class SearchRequest(BaseModel):
    source: SourceName
    query: str = Field(min_length=1, max_length=300)
    limit: int = Field(default=20, ge=1, le=100)
    site: str | None = Field(default=None, max_length=253)
    language: str = Field(default="zh-CN", max_length=20)
    include_promoted: bool = True

    @field_validator("query")
    @classmethod
    def clean_query(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("query must contain non-whitespace characters")
        return cleaned

    @field_validator("site")
    @classmethod
    def clean_site(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().lower().removeprefix("https://").removeprefix("http://").strip("/")
        if not cleaned or any(char.isspace() for char in cleaned):
            raise ValueError("site must be a hostname such as example.com")
        parts = urlsplit(f"//{cleaned}")
        if (
            parts.hostname != cleaned
            or parts.port is not None
            or parts.username is not None
            or parts.password is not None
            or any(character in cleaned for character in "/?#@")
        ):
            raise ValueError("site must contain only a hostname such as example.com")
        return cleaned


class SearchItem(BaseModel):
    source: SourceName
    operation: str = "search"
    query: str
    rank: int = Field(ge=1)
    title: str = ""
    url: str = ""
    author: str = ""
    author_url: str = ""
    published_at: datetime | None = None
    published_text: str = ""
    snippet: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)
    content_type: str = "unknown"
    promoted: bool = False
    fetched_at: datetime = Field(default_factory=utc_now)
    collector: str
    collector_version: str = ""
    partial: bool = True
    raw_ref: str = ""
    warnings: list[str] = Field(default_factory=list)


class SearchResponse(BaseModel):
    ok: bool
    status: ResultStatus
    source: SourceName
    operation: str = "search"
    query: str
    fetched_at: datetime = Field(default_factory=utc_now)
    duration_ms: int = Field(ge=0)
    partial: bool = True
    item_count: int = Field(ge=0)
    items: list[SearchItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    run_id: str = ""
    persistence: PersistenceSummary | None = None


class SourceHealth(BaseModel):
    source: SourceName | str
    status: ResultStatus
    ready: bool
    collector: str
    checked_at: datetime = Field(default_factory=utc_now)
    details: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class FetchRequest(BaseModel):
    url: HttpUrl
    include_tables: bool = True


class ArticleResult(BaseModel):
    url: str
    final_url: str
    title: str = ""
    author: str = ""
    published_at: str = ""
    site_name: str = ""
    text: str = ""
    description: str = ""
    language: str = ""
    fetched_at: datetime = Field(default_factory=utc_now)
    collector: str = "trafilatura"
    warnings: list[str] = Field(default_factory=list)


class FetchResponse(BaseModel):
    ok: bool
    status: ResultStatus
    duration_ms: int = Field(ge=0)
    article: ArticleResult | None = None
    error: str | None = None


class SearchAndFetchRequest(BaseModel):
    platform: str = Field(min_length=1, max_length=100)
    query: str = Field(min_length=1, max_length=300)
    search_limit: int = Field(default=10, ge=1, le=50)
    detail_limit: int = Field(default=3, ge=1, le=5)
    include_tables: bool = True
    options: TaskExecutionOptions = Field(
        default_factory=lambda: TaskExecutionOptions(persistence="none")
    )

    @field_validator("query")
    @classmethod
    def clean_search_and_fetch_query(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("query must contain non-whitespace characters")
        return cleaned

    @field_validator("platform")
    @classmethod
    def normalize_search_and_fetch_platform(cls, value: str) -> str:
        return value.strip().lower()


class DetailFetchItem(BaseModel):
    rank: int = Field(ge=1)
    search_item: SearchItem
    url: str
    ok: bool
    status: ResultStatus
    duration_ms: int = Field(default=0, ge=0)
    article: ArticleResult | None = None
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class SearchAndFetchResponse(BaseModel):
    task_id: str
    ok: bool
    status: ResultStatus
    requested_platform: str
    query: str
    search: TaskExecutionResponse
    detail_capability_id: str
    requested_detail_limit: int = Field(ge=1, le=5)
    attempted_detail_count: int = Field(ge=0)
    successful_detail_count: int = Field(ge=0)
    failed_detail_count: int = Field(ge=0)
    partial: bool = False
    items: list[DetailFetchItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class JobAccepted(BaseModel):
    job_id: str
    status: JobStatus
    created_at: datetime


class JobRecord(BaseModel):
    job_id: str
    kind: str
    source: str
    status: JobStatus
    request: dict[str, Any]
    response: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class SearchRunRecord(BaseModel):
    run_id: str
    job_id: str | None = None
    source: str
    query: str
    site: str | None = None
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    item_count: int = 0
    new_count: int = 0
    changed_count: int = 0
    seen_count: int = 0
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class DocumentRecord(BaseModel):
    document_id: str
    source: str
    identity_key: str
    cross_source_fingerprint: str
    canonical_url: str = ""
    title: str = ""
    author: str = ""
    author_url: str = ""
    published_at: datetime | None = None
    published_text: str = ""
    snippet: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)
    content_type: str = "unknown"
    promoted: bool = False
    collector: str = ""
    first_seen_at: datetime
    last_seen_at: datetime
    observation_count: int = Field(ge=1)
    current_content_hash: str
    latest_payload: dict[str, Any]


class ObservationRecord(BaseModel):
    observation_id: int
    run_id: str
    document_id: str
    rank: int
    observed_at: datetime
    change_type: ChangeType
    content_hash: str
    payload: dict[str, Any]
