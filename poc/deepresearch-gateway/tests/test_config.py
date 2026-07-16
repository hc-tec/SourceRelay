from pathlib import Path

from deepresearch_gateway.config import AdapterSettings, LLMSettings, load_env_file


def test_env_file_is_utf8_and_process_values_win(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment\nDEEPSEEK_API_KEY='file-key'\nDEEPRESEARCH_MODEL=deepseek-reasoner\nINTELLIGENCE_GATEWAY_URL=http://file-gateway:8765\n",
        encoding="utf-8",
    )
    values = load_env_file(env_file, environ={"DEEPSEEK_API_KEY": "process-key"})

    assert values["DEEPSEEK_API_KEY"] == "process-key"
    assert values["DEEPRESEARCH_MODEL"] == "deepseek-reasoner"
    assert values["INTELLIGENCE_GATEWAY_URL"] == "http://file-gateway:8765"


def test_adapter_keeps_llm_and_gateway_configuration_separate(tmp_path: Path) -> None:
    settings = AdapterSettings.from_env(
        environ={
            "DEEPSEEK_API_KEY": "secret",
            "DEEPRESEARCH_MODEL": "deepseek-chat",
            "INTELLIGENCE_GATEWAY_URL": "http://127.0.0.1:8765/",
            "GATEWAY_ARTIFACT_ROOT": str(tmp_path),
        }
    )

    assert settings.gateway_url == "http://127.0.0.1:8765"
    assert settings.llm == LLMSettings(
        provider="deepseek",
        model="deepseek-chat",
        api_key="secret",
        base_url="https://api.deepseek.com",
    )
    assert settings.artifact_root == tmp_path.resolve()
