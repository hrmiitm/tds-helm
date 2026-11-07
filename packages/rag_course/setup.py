from setuptools import setup, find_packages

setup(
    name="rag_course",
    version="4.0.1",
    description="RAG Studio Hands-on Course Helper Package",
    packages=find_packages(),
    python_requires=">=3.11",
    install_requires=[
        "chromadb>=0.5.23",
        "sentence-transformers>=3.3.1",
        "transformers>=4.46.3",
        "torch>=2.4.0",
        "rich>=13.9.4",
        "pydantic>=2.10.1",
        "fastapi>=0.115.5",
        "uvicorn>=0.32.1",
    ],
)

