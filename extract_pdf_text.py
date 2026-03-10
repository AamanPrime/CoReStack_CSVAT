import sys
import os

def extract_text(pdf_path):
    try:
        import pypdf
        print("Using pypdf")
        reader = pypdf.PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text
    except ImportError:
        pass

    try:
        import PyPDF2
        print("Using PyPDF2")
        reader = PyPDF2.PdfReader(pdf_path)
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text
    except ImportError:
        pass

    try:
        from pdfminer.high_level import extract_text
        print("Using pdfminer")
        return extract_text(pdf_path)
    except ImportError:
        pass

    print("No suitable PDF library found (pypdf, PyPDF2, pdfminer.six). Please install one.")
    return None

if __name__ == "__main__":
    pdf_path = "SRS.pdf"
    if not os.path.exists(pdf_path):
        print(f"Error: {pdf_path} not found.")
        sys.exit(1)

    text = extract_text(pdf_path)
    if text:
        # Save to a text file to read it properly
        with open("srs_content.txt", "w", encoding="utf-8") as f:
            f.write(text)
        print("Text extracted to srs_content.txt")
    else:
        sys.exit(1)
