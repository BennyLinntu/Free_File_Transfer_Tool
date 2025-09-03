# File Converter (PDF / DOCX / TXT)

A clean and minimal full-stack web application: upload a PDF / DOCX /
TXT file, convert it to TXT or DOCX, and download the result.

## Features

-   **Source formats:** PDF, DOCX, TXT\
-   **Target formats:** TXT, DOCX\
-   Supported conversions:
    -   PDF → TXT\
    -   PDF → DOCX\
    -   DOCX → TXT\
    -   TXT → DOCX\
    -   DOCX → DOCX (reformat as plain text)\
-   Maximum file size: 25 MB\
-   Temporary files are automatically cleaned up after conversion

## How to Run (Windows / PowerShell)

1.  Install Node.js LTS (if not installed)

    -   Go to <https://nodejs.org/> and download/install the LTS version
        (includes npm)\
    -   Reopen PowerShell after installation

2.  Install dependencies and start

    ``` powershell
    cd "c:\Users\Benny\System File\Desktop\WEB"
    npm install
    npm start
    ```

3.  Open the browser and visit

    -   <http://localhost:3000>

## Project Structure

-   `server.js` -- Backend API (Express) and static file hosting\
-   `public/` -- Frontend pages, styles, and scripts\
-   `uploads/` -- Temporary uploaded files (created automatically at
    runtime)\
-   `converted/` -- Converted files (deleted automatically after
    download)

## FAQ

-   Scanned PDFs (image-only) cannot extract text directly; OCR is
    required.
    -   You may later integrate Tesseract OCR or an online OCR service.\
-   If port 3000 is already in use, set an environment variable
    `PORT=xxxx` before starting.

## Security & Limitations

-   Only performs text extraction and conversion, no macros/scripts
    executed\
-   Uploaded and exported files are cleaned up automatically after
    download

## License

MIT
