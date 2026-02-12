import os
from google import genai


class GeminiClient:
    """Google Gemini API 클라이언트"""

    def __init__(self, api_key: str = None, model: str = "gemini-2.0-flash"):
        self.api_key = api_key or os.getenv("GOOGLE_API_KEY")
        self.model = model
        self.client = genai.Client(api_key=self.api_key)

    def chat(self, message: str, system_prompt: str = None) -> str:
        """단일 메시지를 보내고 응답을 받습니다."""
        config = None
        if system_prompt:
            config = genai.types.GenerateContentConfig(
                system_instruction=system_prompt,
            )

        response = self.client.models.generate_content(
            model=self.model,
            contents=message,
            config=config,
        )
        return response.text

    def analyze_sales(self, sales_data: str) -> str:
        """매출 데이터를 분석합니다."""
        system_prompt = (
            "당신은 1인사업자를 위한 매출 분석 전문가입니다. "
            "주어진 매출 데이터를 분석하고 인사이트를 제공하세요."
        )
        return self.chat(sales_data, system_prompt=system_prompt)

    def analyze_inventory(self, inventory_data: str) -> str:
        """재고 데이터를 분석하고 제안합니다."""
        system_prompt = (
            "당신은 재고 관리 전문가입니다. "
            "재고 데이터를 분석하고 적정 재고량과 발주 시점을 제안하세요."
        )
        return self.chat(inventory_data, system_prompt=system_prompt)

    def ask_finance(self, question: str) -> str:
        """세무/재무 관련 질문에 답변합니다."""
        system_prompt = (
            "당신은 1인사업자를 위한 세무/재무 상담 전문가입니다. "
            "한국 세법 기준으로 정확하고 실용적인 답변을 제공하세요."
        )
        return self.chat(question, system_prompt=system_prompt)
