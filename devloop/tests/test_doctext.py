import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

import _util
from devloop import doctext

spec = importlib.util.spec_from_file_location("make_table", _util.SANDBOX / "spec" / "make_table.py")
make_table = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_table)

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
P = ('xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
     'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
     'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
REL = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"'


class DocTextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_xlsx_rows_and_locations(self):
        p = self.dir / "t.xlsx"
        make_table.write_xlsx(str(p), {"missions": make_table.MISSIONS, "items": make_table.ITEMS})
        r = doctext.extract(p)
        self.assertEqual([s["sheet"] for s in r["sheets"]], ["missions", "items"])
        self.assertIn("   5 | 104 | (이벤트) 클랜전 1회 | clan_match | 0 | item | 9001 | 1 | 10", r["lines"])
        only = doctext.extract(p, sheet="items", max_rows=2)
        self.assertTrue(only["sheets"][0]["truncated"])
        with self.assertRaises(doctext.DocError):
            doctext.extract(p, sheet="nope")

    def test_docx_headings_tables(self):
        p = self.dir / "s.docx"
        body = (f'<w:document {W}><w:body>'
                '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>초기화</w:t></w:r></w:p>'
                '<w:p><w:r><w:t>매일 00:00(UTC)</w:t></w:r></w:p>'
                '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>ID</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>보상</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
                '</w:body></w:document>')
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("word/document.xml", body)
        lines = doctext.extract(p)["lines"]
        self.assertEqual(lines[:2], ["[¶1] # 초기화", "[¶2] 매일 00:00(UTC)"])
        self.assertIn("| ID | 보상 |", lines)

    def test_pptx_slides_in_order(self):
        p = self.dir / "d.pptx"
        with zipfile.ZipFile(p, "w") as z:
            z.writestr("ppt/presentation.xml", f'<p:presentation {P}><p:sldIdLst><p:sldId id="1" r:id="rId2"/>'
                                               '<p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>')
            z.writestr("ppt/_rels/presentation.xml.rels",
                       f'<Relationships {REL}><Relationship Id="rId1" Target="slides/slide1.xml"/>'
                       '<Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>')
            for i, text in ((1, "두번째"), (2, "첫번째")):
                z.writestr(f"ppt/slides/slide{i}.xml", f'<p:sld {P}><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:sld>')
        self.assertEqual(doctext.extract(p)["lines"], ["## slide 1", "첫번째", "## slide 2", "두번째"])

    def test_cp949_csv(self):
        p = self.dir / "t.csv"
        p.write_bytes("id,이름\n1,보급상자\n".encode("cp949"))
        r = doctext.extract(p)
        self.assertEqual((r["decoding"], r["lines"][1]), ("cp949", "   2 | 1 | 보급상자"))

    def test_rejects_non_ooxml(self):
        p = self.dir / "old.xls"
        p.write_bytes(b"\xd0\xcf\x11\xe0 not a zip")
        with self.assertRaises(doctext.DocError):
            doctext.xlsx(p, None, 10)


if __name__ == "__main__":
    unittest.main()
