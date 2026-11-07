"""
mini_rag_project/generator.py — Grounded Prompt Synthesis & Answer Generation
"""

from typing import Optional
try:
    from retriever import SearchResult
    from config import config
except ImportError:
    from .retriever import SearchResult
    from .config import config


class ContextSynthesizer:
    def __init__(self, similarity_threshold: Optional[float] = None):
        self.similarity_threshold = similarity_threshold or config.similarity_threshold

    def build_prompt(self, query: str, context_results: list[SearchResult]) -> str:
        """
        Assemble grounded prompt containing retrieved passages and strict provenance instructions.
        """
        context_blocks = []
        for res in context_results:
            header = f"[Source: {res.source_file} (Chunk {res.chunk_index}) | Sim: {res.similarity_score:.2f}]"
            context_blocks.append(f"{header}\n{res.document_text}")

        formatted_context = "\n\n---\n\n".join(context_blocks)

        prompt = f"""You are a verified corporate policy assistant. Answer the user's question using ONLY the retrieved context passages below.
Do NOT use external knowledge. For every factual assertion, you MUST include the exact source citation anchor (e.g. [{context_results[0].source_file if context_results else 'Doc'}]).
If the retrieved context does not contain sufficient facts to answer the question, state: 'The provided corporate policy documents do not contain information to answer this question.'

RETRIEVED CONTEXT:
{formatted_context}

USER QUESTION:
{query}

GROUNDED ANSWER:"""
        return prompt

    def generate_response(self, query: str, context_results: list[SearchResult]) -> dict:
        """
        Synthesize grounded response, enforcing threshold refusal and source citations.
        """
        # Refusal check: If no results or best similarity is below threshold
        if not context_results or context_results[0].similarity_score < self.similarity_threshold:
            return {
                "answer": "The provided corporate policy documents do not contain information to answer this question.",
                "status": "REFUSED_LOW_CONFIDENCE",
                "top_similarity": context_results[0].similarity_score if context_results else 0.0,
                "citations": []
            }

        top_match = context_results[0]
        citations = list({res.source_file for res in context_results if res.similarity_score >= self.similarity_threshold})

        # Deterministic extraction and grounded summary
        grounded_facts = []
        for res in context_results:
            if res.similarity_score >= self.similarity_threshold:
                grounded_facts.append(f"- Based on [{res.source_file}]: {res.document_text.strip()[:200]}...")

        answer_body = "\n".join(grounded_facts)
        answer = f"According to corporate policy documents:\n{answer_body}\n\n[Verified Source: {', '.join(citations)}]"

        return {
            "answer": answer,
            "status": "GROUNDED_SUCCESS",
            "top_similarity": top_match.similarity_score,
            "citations": citations,
            "best_source": top_match.source_file
        }


if __name__ == "__main__":
    from retriever import SemanticRetriever
    retriever = SemanticRetriever()
    synthesizer = ContextSynthesizer()
    
    q = "Can employees work from home and is there an equipment stipend?"
    matches = retriever.retrieve(q, top_k=2)
    resp = synthesizer.generate_response(q, matches)
    print("STATUS:", resp["status"])
    print("ANSWER:\n", resp["answer"])
