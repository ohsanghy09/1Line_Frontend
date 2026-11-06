"""실제 서버 프로세스의 OpenAI HTTPS 연결을 키 전송·분석 비용 없이 검사한다."""

import httpx2


def connection_issue(error: BaseException) -> tuple[str, str]:
    # 원문 오류에는 요청 정보가 들어갈 수 있으므로 분류에만 사용하고 출력하지 않는다.
    messages = []
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        messages.append(str(error).lower())
        error = error.__cause__ or error.__context__
    description = " ".join(messages)
    if "10013" in description or "permission denied" in description:
        return "openai_network_permission", "AI 서버 실행 환경에서 외부 네트워크 접근이 차단됐어요. 일반 Windows PowerShell에서 서버를 다시 실행해 주세요."
    if "certificate_verify_failed" in description or "certificate verify failed" in description:
        return "openai_tls", "OpenAI HTTPS 인증서 검증에 실패했어요. PC의 인증서·네트워크 설정을 확인해 주세요."
    if "getaddrinfo" in description or "name resolution" in description:
        return "openai_dns", "OpenAI 주소를 확인하지 못했어요. DNS·네트워크 연결을 확인해 주세요."
    return "openai_connection", "OpenAI 서버에 연결하지 못했어요. AI 서버의 네트워크·프록시·방화벽 설정을 확인해 주세요."


async def check_openai_connection():
    try:
        # Authorization 헤더를 보내지 않으므로 정상 네트워크에서는 401도 도달 성공이다.
        async with httpx2.AsyncClient(timeout=10) as client:
            response = await client.get("https://api.openai.com/v1/models")
        return {"connectionStatus": "reachable", "httpStatus": response.status_code, "code": None}
    except httpx2.HTTPError as error:
        code, message = connection_issue(error)
        return {"connectionStatus": "unreachable", "code": code, "error": message}
