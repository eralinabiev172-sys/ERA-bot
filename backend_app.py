import json
import os
import platform
import subprocess
from pathlib import Path
from typing import List

import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


def load_env_file() -> None:
    env_path = Path(__file__).with_name(".env")
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

app = FastAPI(title="Era Bot backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("VITE_GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
]

SYSTEM_PROMPT = """
Ты - Era Bot, персональный AI-ассистент. Твоя задача - анализировать запросы пользователя и помогать ему.

1. Если тебя просят открыть программу (браузер, калькулятор, блокнот) или управлять компьютером:
   обязательно верни строгую JSON-команду: {"type": "os", "action": "open", "target": "название_программы"}
2. Если тебя просят включить или выключить свет в умном доме:
   обязательно верни строгую JSON-команду: {"type": "smarthome", "action": "light", "state": "on/off"}
3. Если тебя просят написать или изменить код:
   напиши чистый рабочий код и оформи его в markdown-блоке, например ```html ... ```.
4. Во всех остальных случаях общайся вежливо и дружелюбно на русском языке.
"""


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    currentCode: str = ""
    language: str = "javascript"


def is_quota_error(error: Exception) -> bool:
    text = str(error).lower()
    return "429" in text or "quota" in text or "rate limit" in text


def is_unsupported_model_error(error: Exception) -> bool:
    text = str(error).lower()
    return "404" in text and ("model" in text or "not found" in text or "not supported" in text)


def generate_with_fallback(formatted_contents: list[dict]) -> str:
    quota_errors = []
    skipped_models = []
    last_error = None

    for model_name in GEMINI_MODELS:
        try:
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=SYSTEM_PROMPT,
            )
            response = model.generate_content(formatted_contents)
            return response.text.strip()
        except Exception as error:
            last_error = error
            if is_quota_error(error):
                quota_errors.append(f"{model_name}: {error}")
                continue
            if is_unsupported_model_error(error):
                skipped_models.append(model_name)
                continue
            raise

    if quota_errors:
        raise HTTPException(
            status_code=429,
            detail=(
                "Gemini API лимит временно закончился для доступных моделей. "
                "Подожди немного и попробуй снова, либо создай новый API key / включи billing в Google AI Studio."
            ),
        )

    if skipped_models:
        raise HTTPException(
            status_code=404,
            detail=(
                "Ни одна модель Gemini из списка backend сейчас не доступна для этого API key. "
                f"Пропущенные модели: {', '.join(skipped_models)}."
            ),
        )

    raise last_error or RuntimeError("Gemini did not return a response.")


def execute_local_command(target: str | None) -> str:
    if not target:
        return "Не понял, какую программу нужно открыть."

    target_lower = target.lower()
    system_os = platform.system()

    if system_os == "Windows":
        allowed_apps = {
            "браузер": ["cmd", "/c", "start", "", "chrome"],
            "калькулятор": ["calc"],
            "блокнот": ["notepad"],
            "проводник": ["explorer"],
        }
    elif system_os == "Darwin":
        allowed_apps = {
            "браузер": ["open", "-a", "Google Chrome"],
            "калькулятор": ["open", "-a", "Calculator"],
            "блокнот": ["open", "-a", "TextEdit"],
            "проводник": ["open", "."],
        }
    else:
        allowed_apps = {
            "браузер": ["xdg-open", "https://google.com"],
            "калькулятор": ["gnome-calculator"],
            "проводник": ["xdg-open", "."],
        }

    command = allowed_apps.get(target_lower)
    if not command:
        return f"Запуск приложения '{target}' отклонен в целях безопасности: его нет в списке разрешенных."

    try:
        subprocess.Popen(command)
        return f"Успешно запустил {target} на твоем компьютере."
    except Exception as error:
        return f"Не удалось запустить {target}. Ошибка: {error}"


def execute_smarthome_light(state: str | None) -> str:
    if state not in {"on", "off"}:
        return "Не понял состояние света. Можно использовать только on или off."

    state_ru = "включен" if state == "on" else "выключен"
    print(f"[УМНЫЙ ДОМ] Локальный сигнал отправлен. Свет: {state_ru}")
    return f"Сигнал умного дома выполнен. Свет успешно {state_ru}."


@app.get("/api/health")
async def healthcheck():
    return {"status": "ok", "gemini_configured": bool(GEMINI_API_KEY)}


@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Добавь GEMINI_API_KEY в переменные окружения проекта.",
        )

    try:
        formatted_contents = []
        for message in request.messages:
            role = "user" if message.role == "user" else "model"
            formatted_contents.append({"role": role, "parts": [{"text": message.content}]})

        if request.currentCode:
            formatted_contents.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": (
                                f"[КОНТЕКСТ РЕДАКТОРА, язык: {request.language}]:\n"
                                f"```\n{request.currentCode}\n```"
                            ),
                        }
                    ],
                }
            )

        response_text = generate_with_fallback(formatted_contents)

        try:
            clean_json = response_text.replace("```json", "").replace("```", "").strip()
            command_data = json.loads(clean_json)

            if command_data.get("type") == "os":
                execution_result = execute_local_command(command_data.get("target"))
                return {
                    "role": "assistant",
                    "content": execution_result,
                    "type": "action",
                    "action_type": "os",
                }

            if command_data.get("type") == "smarthome":
                execution_result = execute_smarthome_light(command_data.get("state"))
                return {
                    "role": "assistant",
                    "content": execution_result,
                    "type": "action",
                    "action_type": "smarthome",
                }

        except (json.JSONDecodeError, ValueError):
            pass

        return {
            "role": "assistant",
            "content": response_text,
            "type": "text",
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
