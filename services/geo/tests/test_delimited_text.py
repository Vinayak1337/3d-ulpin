"""Small generated controls for the shared delimited-table reading policy."""
import unittest

from geo.delimited_text import choose_delimiter, table_dict_reader, table_reading


class DelimitedTextTest(unittest.TestCase):
    def test_delimiters_quotes_and_short_comma(self) -> None:
        for delimiter in (",", ";", "\t", "|"):
            text = f'key{delimiter}note\nA{delimiter}"inside{delimiter} quote ""and""\nnewline"\n'
            decoded, reading = table_reading(text.encode("utf-8"))
            self.assertEqual(reading, {"delimiter": delimiter, "encoding": "utf-8"})
            rows = list(table_dict_reader(decoded, reading["delimiter"]))
            self.assertEqual(rows, [{"key": "A", "note": f'inside{delimiter} quote "and"\nnewline'}])
        self.assertEqual(choose_delimiter("label\nvalue\n"), ",")
        self.assertEqual(choose_delimiter("a;b\n1;2;3\n"), ",")
        self.assertEqual(choose_delimiter("a,b,c\tz\n1,2,3\t4\n", "judge.tsv"), "\t")
        self.assertEqual(choose_delimiter("\n\na;b\n1;2\n"), ";")
        self.assertEqual(choose_delimiter(";;\na;b\n1;2\n"), ";")

    def test_encodings_and_boms(self) -> None:
        text = "clé;note\nA;café\n"
        controls = [
            (b"\xff\xfe" + text.encode("utf-16le"), "utf-16le"),
            (b"\xfe\xff" + text.encode("utf-16be"), "utf-16be"),
            (text.encode("utf-8-sig"), "utf-8"),
            (text.encode("cp1252"), "windows-1252"),
        ]
        for raw, encoding in controls:
            decoded, reading = table_reading(raw)
            self.assertEqual(decoded, text)
            self.assertEqual(reading, {"delimiter": ";", "encoding": encoding})
            self.assertEqual(list(table_dict_reader(decoded, reading["delimiter"])), [{"clé": "A", "note": "café"}])

    def test_native_readers_keep_their_reading_metadata(self) -> None:
        from geo.inspection import inspect_bytes
        from geo.native_schedule import extract_reference_table, extract_schedule

        text = 'key;note\nA;"café; quoted"\n'
        reference = extract_reference_table(text.encode("cp1252"))
        self.assertEqual(reference["encoding"], "windows-1252")
        self.assertEqual(reference["delimiter"], ";")
        self.assertIn("café; quoted", reference["parts"][0]["text"])
        self.assertEqual(reference["candidates"], [])
        schedule_text = "alias\tlower\tupper\tunit\tbenchmark\nA\t0\t3\tm\tBM-é\n"
        schedule = extract_schedule(b"\xff\xfe" + schedule_text.encode("utf-16le"))
        self.assertEqual(schedule["encoding"], "utf-16le")
        self.assertEqual(schedule["delimiter"], "\t")
        self.assertEqual([item["value"] for item in schedule["candidates"]], [0, 3])
        controls = inspect_bytes("control-csv-v1", b"id|x|y|unit|benchmark\nA|0|0|m|BM\n")
        self.assertEqual(controls["delimiter"], "|")
        self.assertEqual(controls["encoding"], "utf-8")
        self.assertEqual(controls["status"], "needs_input")


def main() -> None:
    unittest.main()


if __name__ == "__main__":
    main()
