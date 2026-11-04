# Antigravity 2.0 한국어 번역기 (Thinking 표시 보장 규칙)

- `ko-thought-translator` 플러그인이 활성화된 동안에는 사용자가 대화 중 추론 과정(Thinking 블록)을 실시간으로 확인할 수 있도록, 모델의 기본 추론 강도(`EFFORT LEVEL: 0.20` 등 경량 설정 포함)나 이전 대화 이력의 빈 `<thought>` 여부와 무관하게 **매 응답 및 도구 호출 전 `<thought>` 블록에 최소 2~3문장 이상 구체적인 상황 판단·근거·다음 행동 계획**을 작성한다.
- `<thought></thought>`를 비워 두거나 1문장 단문으로 생략하면 백엔드 Thought Summarizer가 추론 요약(`thinking`)을 빈 문자열로 생략하므로, 매 스텝 충분한 밀도의 추론 문단을 유지한다.
