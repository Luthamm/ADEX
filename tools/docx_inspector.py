#!/usr/bin/env python3
"""
DOCX Inspector - Deconstructs DOCX files to show their XML structure and styling.
Useful for debugging table import/rendering issues in SuperDoc.

Double-click to run the GUI, or use command line:
    python docx_inspector.py <path_to_docx> [options]

Options:
    --tables-only    Only show table-related XML
    --output <file>  Write output to file instead of console
    --raw            Show raw XML without filtering
    --no-gui         Force command-line mode
"""

import zipfile
import sys
import os
import argparse
from pathlib import Path
from xml.dom import minidom
import xml.etree.ElementTree as ET
import json
import threading

# OOXML namespaces
NAMESPACES = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
    'w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
}

# Register namespaces for cleaner output
for prefix, uri in NAMESPACES.items():
    ET.register_namespace(prefix, uri)


def extract_docx(docx_path: str) -> dict:
    """Extract all XML files from a DOCX archive."""
    contents = {}
    with zipfile.ZipFile(docx_path, 'r') as zf:
        for name in zf.namelist():
            if name.endswith('.xml') or name.endswith('.rels'):
                try:
                    contents[name] = zf.read(name).decode('utf-8')
                except Exception as e:
                    contents[name] = f"Error reading: {e}"
    return contents


def prettify_xml(xml_string: str) -> str:
    """Pretty print XML with proper indentation."""
    try:
        dom = minidom.parseString(xml_string.encode('utf-8'))
        pretty = dom.toprettyxml(indent="  ")
        lines = [line for line in pretty.split('\n') if line.strip()]
        return '\n'.join(lines)
    except Exception as e:
        return f"Error parsing XML: {e}\n\nRaw content:\n{xml_string[:2000]}..."


def extract_tables_xml(xml_string: str) -> list:
    """Extract all table elements from document XML."""
    tables = []
    try:
        root = ET.fromstring(xml_string)
        for i, tbl in enumerate(root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tbl')):
            table_xml = ET.tostring(tbl, encoding='unicode')
            tables.append({
                'index': i,
                'xml': prettify_xml(table_xml),
                'element': tbl
            })
    except Exception as e:
        return [{'error': str(e)}]
    return tables


def analyze_table(tbl_element) -> dict:
    """Analyze a table element and extract key properties."""
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

    analysis = {
        'properties': {},
        'grid': [],
        'rows': [],
        'summary': {}
    }

    # Table properties (w:tblPr)
    tblPr = tbl_element.find('w:tblPr', ns)
    if tblPr is not None:
        props = {}

        # Table style
        style = tblPr.find('w:tblStyle', ns)
        if style is not None:
            props['style'] = style.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')

        # Table width
        tblW = tblPr.find('w:tblW', ns)
        if tblW is not None:
            props['width'] = {
                'value': tblW.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w'),
                'type': tblW.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type')
            }

        # Table layout
        tblLayout = tblPr.find('w:tblLayout', ns)
        if tblLayout is not None:
            props['layout'] = tblLayout.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type')

        # Justification
        jc = tblPr.find('w:jc', ns)
        if jc is not None:
            props['justification'] = jc.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')

        # Borders
        tblBorders = tblPr.find('w:tblBorders', ns)
        if tblBorders is not None:
            borders = {}
            for border_type in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
                border = tblBorders.find(f'w:{border_type}', ns)
                if border is not None:
                    borders[border_type] = {
                        'val': border.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val'),
                        'sz': border.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sz'),
                        'color': border.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}color'),
                        'space': border.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}space'),
                    }
            props['borders'] = borders

        # Cell margins
        tblCellMar = tblPr.find('w:tblCellMar', ns)
        if tblCellMar is not None:
            margins = {}
            for side in ['top', 'left', 'bottom', 'right']:
                margin = tblCellMar.find(f'w:{side}', ns)
                if margin is not None:
                    margins[side] = {
                        'w': margin.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w'),
                        'type': margin.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type')
                    }
            props['cellMargins'] = margins

        # Table indent
        tblInd = tblPr.find('w:tblInd', ns)
        if tblInd is not None:
            props['indent'] = {
                'w': tblInd.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w'),
                'type': tblInd.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type')
            }

        # Cell spacing
        tblCellSpacing = tblPr.find('w:tblCellSpacing', ns)
        if tblCellSpacing is not None:
            props['cellSpacing'] = {
                'w': tblCellSpacing.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w'),
                'type': tblCellSpacing.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type')
            }

        analysis['properties'] = props

    # Table grid (w:tblGrid)
    tblGrid = tbl_element.find('w:tblGrid', ns)
    if tblGrid is not None:
        for col in tblGrid.findall('w:gridCol', ns):
            width = col.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w')
            analysis['grid'].append({
                'width_twips': width,
                'width_px': round(int(width) / 15, 2) if width else None
            })

    # Rows (w:tr)
    rows = tbl_element.findall('w:tr', ns)
    for row_idx, tr in enumerate(rows):
        row_data = {
            'index': row_idx,
            'properties': {},
            'cells': []
        }

        # Row properties
        trPr = tr.find('w:trPr', ns)
        if trPr is not None:
            # Row height
            trHeight = trPr.find('w:trHeight', ns)
            if trHeight is not None:
                row_data['properties']['height'] = {
                    'val': trHeight.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val'),
                    'hRule': trHeight.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}hRule')
                }

            # Header row
            tblHeader = trPr.find('w:tblHeader', ns)
            if tblHeader is not None:
                row_data['properties']['isHeader'] = True

        # Cells (w:tc)
        cells = tr.findall('w:tc', ns)
        for cell_idx, tc in enumerate(cells):
            cell_data = {
                'index': cell_idx,
                'properties': {},
                'content_preview': ''
            }

            # Cell properties
            tcPr = tc.find('w:tcPr', ns)
            if tcPr is not None:
                # Cell width
                tcW = tcPr.find('w:tcW', ns)
                if tcW is not None:
                    cell_data['properties']['width'] = {
                        'w': tcW.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}w'),
                        'type': tcW.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type')
                    }

                # Grid span (colspan)
                gridSpan = tcPr.find('w:gridSpan', ns)
                if gridSpan is not None:
                    cell_data['properties']['gridSpan'] = gridSpan.get(
                        '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')

                # Vertical merge (rowspan)
                vMerge = tcPr.find('w:vMerge', ns)
                if vMerge is not None:
                    val = vMerge.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')
                    cell_data['properties']['vMerge'] = val if val else 'continue'

                # Horizontal merge
                hMerge = tcPr.find('w:hMerge', ns)
                if hMerge is not None:
                    val = hMerge.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')
                    cell_data['properties']['hMerge'] = val if val else 'continue'

                # Vertical alignment
                vAlign = tcPr.find('w:vAlign', ns)
                if vAlign is not None:
                    cell_data['properties']['vAlign'] = vAlign.get(
                        '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')

                # Cell borders
                tcBorders = tcPr.find('w:tcBorders', ns)
                if tcBorders is not None:
                    borders = {}
                    for border_type in ['top', 'left', 'bottom', 'right']:
                        border = tcBorders.find(f'w:{border_type}', ns)
                        if border is not None:
                            borders[border_type] = {
                                'val': border.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val'),
                                'sz': border.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sz'),
                                'color': border.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}color'),
                            }
                    if borders:
                        cell_data['properties']['borders'] = borders

                # Shading (background color)
                shd = tcPr.find('w:shd', ns)
                if shd is not None:
                    cell_data['properties']['shading'] = {
                        'fill': shd.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fill'),
                        'val': shd.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val'),
                        'color': shd.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}color'),
                    }

                # Text direction
                textDirection = tcPr.find('w:textDirection', ns)
                if textDirection is not None:
                    cell_data['properties']['textDirection'] = textDirection.get(
                        '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')

            # Content preview (extract text)
            text_parts = []
            for t in tc.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
                if t.text:
                    text_parts.append(t.text)
            cell_data['content_preview'] = ' '.join(text_parts)[:100]

            row_data['cells'].append(cell_data)

        analysis['rows'].append(row_data)

    # Summary
    analysis['summary'] = {
        'total_rows': len(rows),
        'total_columns': len(analysis['grid']),
        'has_merged_cells': any(
            'gridSpan' in cell.get('properties', {}) or 'vMerge' in cell.get('properties', {})
            for row in analysis['rows']
            for cell in row['cells']
        ),
        'total_grid_width_twips': sum(int(col['width_twips'] or 0) for col in analysis['grid']),
        'total_grid_width_px': sum(col['width_px'] or 0 for col in analysis['grid']),
    }

    return analysis


def extract_table_styles(styles_xml: str) -> list:
    """Extract table-related styles from styles.xml."""
    table_styles = []
    try:
        root = ET.fromstring(styles_xml)
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

        for style in root.findall('.//w:style', ns):
            style_type = style.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}type')
            if style_type == 'table':
                style_id = style.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId')
                name_elem = style.find('w:name', ns)
                name = name_elem.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val') if name_elem is not None else None

                table_styles.append({
                    'styleId': style_id,
                    'name': name,
                    'xml': prettify_xml(ET.tostring(style, encoding='unicode'))
                })
    except Exception as e:
        return [{'error': str(e)}]

    return table_styles


def format_section(title: str, content: str) -> str:
    """Format a section with title and content."""
    separator = "=" * 80
    return f"\n{separator}\n{title}\n{separator}\n{content}\n"


def inspect_docx(docx_path: str, tables_only: bool = True, include_raw_xml: bool = True) -> str:
    """Main inspection function that returns formatted output."""
    output = []

    if not os.path.exists(docx_path):
        return f"Error: File not found: {docx_path}"

    try:
        contents = extract_docx(docx_path)
    except Exception as e:
        return f"Error extracting DOCX: {e}"

    output.append(format_section("DOCX INSPECTOR",
                                 f"File: {docx_path}\nFiles in archive: {len(contents)}"))

    doc_xml = contents.get('word/document.xml', '')
    tables = extract_tables_xml(doc_xml)

    output.append(format_section("TABLES FOUND", f"Total tables: {len(tables)}"))

    for table in tables:
        if 'error' in table:
            output.append(format_section("Error", table['error']))
            continue

        # Analysis
        analysis = analyze_table(table['element'])
        output.append(format_section(f"TABLE {table['index']} - ANALYSIS",
                                     json.dumps(analysis, indent=2)))

        # Raw XML
        if include_raw_xml:
            output.append(format_section(f"TABLE {table['index']} - RAW XML", table['xml']))

    # Table styles
    styles_xml = contents.get('word/styles.xml', '')
    if styles_xml:
        table_styles = extract_table_styles(styles_xml)
        if table_styles:
            for style in table_styles:
                if 'error' in style:
                    output.append(format_section("Style Error", style['error']))
                else:
                    output.append(format_section(
                        f"TABLE STYLE: {style['styleId']} ({style['name']})",
                        style['xml']))

    if not tables_only:
        # Show other key files
        key_files = ['word/document.xml', 'word/styles.xml', 'word/numbering.xml']
        for file_name in key_files:
            if file_name in contents:
                output.append(format_section(file_name, prettify_xml(contents[file_name])))

    return ''.join(output)


# ============================================================================
# GUI Application
# ============================================================================

def run_gui():
    """Run the GUI application."""
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox

    class DocxInspectorApp:
        def __init__(self, root):
            self.root = root
            self.root.title("DOCX Inspector - Table Analyzer")
            self.root.geometry("1000x700")
            self.root.minsize(800, 500)

            # Configure style
            style = ttk.Style()
            style.configure('Title.TLabel', font=('Segoe UI', 14, 'bold'))
            style.configure('TButton', font=('Segoe UI', 10))

            self.setup_ui()

        def setup_ui(self):
            # Main container
            main_frame = ttk.Frame(self.root, padding="10")
            main_frame.pack(fill=tk.BOTH, expand=True)

            # Title
            title_label = ttk.Label(main_frame, text="DOCX Table Inspector",
                                    style='Title.TLabel')
            title_label.pack(pady=(0, 10))

            # Top controls frame
            controls_frame = ttk.Frame(main_frame)
            controls_frame.pack(fill=tk.X, pady=(0, 10))

            # File selection
            self.file_path_var = tk.StringVar()
            file_entry = ttk.Entry(controls_frame, textvariable=self.file_path_var,
                                   width=60, state='readonly')
            file_entry.pack(side=tk.LEFT, padx=(0, 10), fill=tk.X, expand=True)

            browse_btn = ttk.Button(controls_frame, text="Browse...",
                                    command=self.browse_file)
            browse_btn.pack(side=tk.LEFT, padx=(0, 10))

            analyze_btn = ttk.Button(controls_frame, text="Analyze",
                                     command=self.analyze_file)
            analyze_btn.pack(side=tk.LEFT, padx=(0, 10))

            # Options frame
            options_frame = ttk.Frame(main_frame)
            options_frame.pack(fill=tk.X, pady=(0, 10))

            self.tables_only_var = tk.BooleanVar(value=True)
            tables_check = ttk.Checkbutton(options_frame, text="Tables only",
                                           variable=self.tables_only_var)
            tables_check.pack(side=tk.LEFT, padx=(0, 20))

            self.include_xml_var = tk.BooleanVar(value=True)
            xml_check = ttk.Checkbutton(options_frame, text="Include raw XML",
                                        variable=self.include_xml_var)
            xml_check.pack(side=tk.LEFT, padx=(0, 20))

            copy_btn = ttk.Button(options_frame, text="Copy to Clipboard",
                                  command=self.copy_to_clipboard)
            copy_btn.pack(side=tk.RIGHT, padx=(10, 0))

            save_btn = ttk.Button(options_frame, text="Save to File",
                                  command=self.save_to_file)
            save_btn.pack(side=tk.RIGHT)

            # Output text area with scrollbar
            output_frame = ttk.Frame(main_frame)
            output_frame.pack(fill=tk.BOTH, expand=True)

            # Scrollbars
            y_scroll = ttk.Scrollbar(output_frame, orient=tk.VERTICAL)
            y_scroll.pack(side=tk.RIGHT, fill=tk.Y)

            x_scroll = ttk.Scrollbar(output_frame, orient=tk.HORIZONTAL)
            x_scroll.pack(side=tk.BOTTOM, fill=tk.X)

            # Text widget
            self.output_text = tk.Text(output_frame, wrap=tk.NONE,
                                       font=('Consolas', 10),
                                       yscrollcommand=y_scroll.set,
                                       xscrollcommand=x_scroll.set)
            self.output_text.pack(fill=tk.BOTH, expand=True)

            y_scroll.config(command=self.output_text.yview)
            x_scroll.config(command=self.output_text.xview)

            # Status bar
            self.status_var = tk.StringVar(value="Ready - Select a DOCX file to analyze")
            status_bar = ttk.Label(main_frame, textvariable=self.status_var,
                                   relief=tk.SUNKEN, anchor=tk.W)
            status_bar.pack(fill=tk.X, pady=(10, 0))

            # Welcome message
            self.output_text.insert(tk.END, """
================================================================================
                        DOCX Table Inspector
================================================================================

Welcome! This tool analyzes DOCX files and extracts table structure information.

Instructions:
1. Click "Browse..." to select a DOCX file
2. Click "Analyze" to inspect the file
3. Use "Copy to Clipboard" or "Save to File" to export the results

The output includes:
- Table properties (width, borders, layout)
- Column grid definitions (widths in twips and pixels)
- Row-by-row cell analysis (merging, styling, content)
- Table styles from styles.xml

This is useful for debugging table import/rendering issues in SuperDoc.
""")

        def browse_file(self):
            file_path = filedialog.askopenfilename(
                title="Select DOCX file",
                filetypes=[("Word Documents", "*.docx"), ("All files", "*.*")]
            )
            if file_path:
                self.file_path_var.set(file_path)
                self.status_var.set(f"Selected: {os.path.basename(file_path)}")

        def analyze_file(self):
            file_path = self.file_path_var.get()
            if not file_path:
                messagebox.showwarning("No file selected",
                                       "Please select a DOCX file first.")
                return

            self.status_var.set("Analyzing...")
            self.root.update()

            # Run analysis in thread to keep UI responsive
            def do_analysis():
                try:
                    result = inspect_docx(
                        file_path,
                        tables_only=self.tables_only_var.get(),
                        include_raw_xml=self.include_xml_var.get()
                    )
                    self.root.after(0, lambda: self.show_result(result))
                except Exception as e:
                    self.root.after(0, lambda: self.show_error(str(e)))

            thread = threading.Thread(target=do_analysis)
            thread.start()

        def show_result(self, result):
            self.output_text.delete(1.0, tk.END)
            self.output_text.insert(tk.END, result)
            self.output_text.see(1.0)
            self.status_var.set("Analysis complete")

        def show_error(self, error):
            self.output_text.delete(1.0, tk.END)
            self.output_text.insert(tk.END, f"Error: {error}")
            self.status_var.set("Error occurred")

        def copy_to_clipboard(self):
            content = self.output_text.get(1.0, tk.END)
            self.root.clipboard_clear()
            self.root.clipboard_append(content)
            self.status_var.set("Copied to clipboard!")

        def save_to_file(self):
            content = self.output_text.get(1.0, tk.END)
            if not content.strip():
                messagebox.showwarning("No content", "Nothing to save.")
                return

            file_path = filedialog.asksaveasfilename(
                title="Save output",
                defaultextension=".txt",
                filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
            )
            if file_path:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                self.status_var.set(f"Saved to: {file_path}")

    root = tk.Tk()
    app = DocxInspectorApp(root)
    root.mainloop()


# ============================================================================
# Command Line Interface
# ============================================================================

def print_section(title: str, content: str, file=None):
    """Print a formatted section."""
    output = format_section(title, content)
    if file:
        file.write(output)
    else:
        print(output)


def run_cli():
    """Run the command-line interface."""
    parser = argparse.ArgumentParser(description='Inspect DOCX file structure')
    parser.add_argument('docx_path', help='Path to the DOCX file')
    parser.add_argument('--tables-only', action='store_true', help='Only show table-related XML')
    parser.add_argument('--output', '-o', help='Output file path')
    parser.add_argument('--raw', action='store_true', help='Show raw XML without analysis')
    parser.add_argument('--extract-to', help='Extract all XML files to a directory')
    parser.add_argument('--no-gui', action='store_true', help='Force command-line mode')

    args = parser.parse_args()

    if not os.path.exists(args.docx_path):
        print(f"Error: File not found: {args.docx_path}")
        sys.exit(1)

    # Extract DOCX contents
    print(f"Extracting: {args.docx_path}")
    contents = extract_docx(args.docx_path)

    # If extracting to directory
    if args.extract_to:
        extract_dir = Path(args.extract_to)
        extract_dir.mkdir(parents=True, exist_ok=True)
        for name, content in contents.items():
            file_path = extract_dir / name
            file_path.parent.mkdir(parents=True, exist_ok=True)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(prettify_xml(content) if content.startswith('<?xml') else content)
        print(f"Extracted {len(contents)} files to: {extract_dir}")
        return

    # Open output file if specified
    out_file = open(args.output, 'w', encoding='utf-8') if args.output else None

    try:
        if args.tables_only:
            doc_xml = contents.get('word/document.xml', '')
            tables = extract_tables_xml(doc_xml)

            print_section("DOCX TABLE INSPECTOR",
                         f"File: {args.docx_path}\nTables found: {len(tables)}", out_file)

            for table in tables:
                if 'error' in table:
                    print_section("Error", table['error'], out_file)
                    continue

                print_section(f"TABLE {table['index']} - RAW XML", table['xml'], out_file)

                if not args.raw:
                    analysis = analyze_table(table['element'])
                    print_section(f"TABLE {table['index']} - ANALYSIS",
                                 json.dumps(analysis, indent=2), out_file)

            styles_xml = contents.get('word/styles.xml', '')
            if styles_xml:
                table_styles = extract_table_styles(styles_xml)
                if table_styles:
                    print_section("TABLE STYLES", "", out_file)
                    for style in table_styles:
                        if 'error' in style:
                            print_section("Error", style['error'], out_file)
                        else:
                            print_section(f"Style: {style['styleId']} ({style['name']})",
                                         style['xml'], out_file)
        else:
            print_section("DOCX STRUCTURE INSPECTOR",
                         f"File: {args.docx_path}\nFiles found: {len(contents)}", out_file)
            print_section("FILES IN DOCX", '\n'.join(sorted(contents.keys())), out_file)

            key_files = [
                'word/document.xml',
                'word/styles.xml',
                'word/numbering.xml',
                'word/settings.xml',
                'word/_rels/document.xml.rels',
            ]

            for file_name in key_files:
                if file_name in contents:
                    content = contents[file_name]
                    if args.raw:
                        print_section(file_name, content, out_file)
                    else:
                        print_section(file_name, prettify_xml(content), out_file)

            doc_xml = contents.get('word/document.xml', '')
            tables = extract_tables_xml(doc_xml)

            if tables:
                print_section("TABLE ANALYSIS", f"Found {len(tables)} table(s)", out_file)
                for table in tables:
                    if 'error' not in table:
                        analysis = analyze_table(table['element'])
                        print_section(f"Table {table['index']} Summary",
                                     json.dumps(analysis, indent=2), out_file)

    finally:
        if out_file:
            out_file.close()
            print(f"Output written to: {args.output}")


# ============================================================================
# Entry Point
# ============================================================================

if __name__ == '__main__':
    # If no command line args (double-clicked), run GUI
    # If args provided, run CLI
    if len(sys.argv) == 1:
        run_gui()
    elif '--no-gui' in sys.argv or len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
        run_cli()
    else:
        # Check if it's just options without a file path
        run_gui()
