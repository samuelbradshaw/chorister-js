"""Generate a synthetic 'Two-Part' MusicXML fixture.

Same structural shape as "A Child's Prayer" (1989 CSB), which is copyrighted:
  - two vocal parts on separate staves, each with its own complete lyric line
  - a repeat with a combined 1st/2nd ending and a separate 3rd ending (3 renditions)
  - a labelled "(3.)" pickup engraved as a triplet inside the shared ending
All words are invented.
"""

DIV = 12  # divisions per quarter

P1_WORDS = ['We', 'sing', 'a', 'song', 'of', 'praise', 'to', 'day', 'with', 'heart', 'and', 'voice']
P2_WORDS = ['You', 'hear', 'our', 'call', 'and', 'know', 'each', 'name', 'in', 'ev', 'ery', 'place']
# ('ev', 'ery') is a hyphenated word, so P2 exercises multi-syllable words too
P2_SYLLABIC = ['single'] * 9 + ['begin', 'end', 'single']

P1_PITCHES = [('C', 5), ('D', 5), ('E', 5), ('F', 5)] * 3
P2_PITCHES = [('E', 4), ('F', 4), ('G', 4), ('A', 4)] * 3


def note(step, octave, duration, lyric_xml='', extra='', note_type='quarter'):
    return f"""      <note>
        <pitch><step>{step}</step><octave>{octave}</octave></pitch>
        <duration>{duration}</duration>
        <voice>1</voice>
        <type>{note_type}</type>
{extra}{lyric_xml}      </note>
"""


def lyric(number, text, syllabic='single', label=None):
    label_xml = ''
    if label:
        label_xml = (f'          <syllabic>single</syllabic>\n'
                     f'          <text>{label}</text>\n'
                     f'          <elision> </elision>\n')
    return (f'        <lyric number="{number}">\n{label_xml}'
            f'          <syllabic>{syllabic}</syllabic>\n'
            f'          <text>{text}</text>\n'
            f'        </lyric>\n')


def rest(duration, note_type):
    return f"""      <note>
        <rest/>
        <duration>{duration}</duration>
        <voice>1</voice>
        <type>{note_type}</type>
      </note>
"""


def body_measures(words, pitches, lyric_number, syllabics, marker):
    out = []
    for m in range(3):
        attrs = ''
        barline = ''
        if m == 0:
            attrs = (f'      <attributes>\n'
                     f'        <divisions>{DIV}</divisions>\n'
                     f'        <key><fifths>0</fifths></key>\n'
                     f'        <time><beats>4</beats><beat-type>4</beat-type></time>\n'
                     f'        <clef><sign>G</sign><line>2</line></clef>\n'
                     f'      </attributes>\n')
            barline = ('      <barline location="left">\n'
                       '        <bar-style>heavy-light</bar-style>\n'
                       '        <repeat direction="forward"/>\n'
                       '      </barline>\n')
        notes = ''
        for i in range(4):
            idx = m * 4 + i
            step, octave = pitches[idx]
            notes += note(step, octave, DIV,
                          lyric(lyric_number, words[idx], syllabics[idx],
                                marker if idx == 0 else None))
        out.append(f'    <measure number="{m + 1}">\n{attrs}{barline}{notes}    </measure>\n')
    return ''.join(out)


def triplet_note(step, octave, text, syllabic, label, position):
    """One triplet eighth: 3 in the time of 2, so DIV*2//3 = 8 divisions each."""
    extra = ('        <time-modification>\n'
             '          <actual-notes>3</actual-notes>\n'
             '          <normal-notes>2</normal-notes>\n'
             '        </time-modification>\n')
    if position == 'start':
        extra += '        <beam number="1">begin</beam>\n'
        extra += '        <notations><tuplet number="1" type="start" placement="above"/></notations>\n'
    elif position == 'stop':
        extra += '        <beam number="1">end</beam>\n'
        extra += '        <notations><tuplet number="1" type="stop"/></notations>\n'
    else:
        extra += '        <beam number="1">continue</beam>\n'
    return note(step, octave, DIV * 2 // 3, lyric(1, text, syllabic, label), extra, 'eighth')


def build():
    # ── Part 1: body, then the 1st/2nd ending carrying the "(3.)" triplet pickup ──
    p1 = body_measures(P1_WORDS, P1_PITCHES, 1, ['single'] * 12, '1.')
    p1 += ('    <measure number="4">\n'
           '      <barline location="left">\n'
           '        <ending number="1, 2" type="start"/>\n'
           '      </barline>\n'
           + note('G', 5, DIV * 2, lyric(1, 'Amen.'), note_type='half')
           + rest(DIV, 'quarter')
           + triplet_note('D', 5, 'Ho', 'begin', '(3.)', 'start')
           + triplet_note('E', 5, 'san', 'middle', None, 'continue')
           + triplet_note('F', 5, 'na', 'end', None, 'stop')
           + '      <barline location="right">\n'
             '        <bar-style>light-heavy</bar-style>\n'
             '        <ending number="1, 2" type="stop"/>\n'
             '        <repeat direction="backward"/>\n'
             '      </barline>\n'
             '    </measure>\n')
    p1 += ('    <measure number="5">\n'
           '      <barline location="left">\n'
           '        <ending number="3" type="start"/>\n'
           '      </barline>\n'
           + note('C', 5, DIV * 4, lyric(1, 'Amen.'), note_type='whole')
           + '      <barline location="right">\n'
             '        <bar-style>light-heavy</bar-style>\n'
             '        <ending number="3" type="discontinue"/>\n'
             '      </barline>\n'
             '    </measure>\n')

    # ── Part 2: body, then its own word in each ending ──
    p2 = body_measures(P2_WORDS, P2_PITCHES, 2, P2_SYLLABIC, '2.')
    p2 += ('    <measure number="4">\n'
           '      <barline location="left">\n'
           '        <ending number="1, 2" type="start"/>\n'
           '      </barline>\n'
           + note('C', 4, DIV * 2, lyric(2, 'Amen.'), note_type='half')
           + rest(DIV * 2, 'half')
           + '      <barline location="right">\n'
             '        <bar-style>light-heavy</bar-style>\n'
             '        <ending number="1, 2" type="stop"/>\n'
             '        <repeat direction="backward"/>\n'
             '      </barline>\n'
             '    </measure>\n')
    p2 += ('    <measure number="5">\n'
           '      <barline location="left">\n'
           '        <ending number="3" type="start"/>\n'
           '      </barline>\n'
           + note('E', 4, DIV * 4, lyric(2, 'Amen.'), note_type='whole')
           + '      <barline location="right">\n'
             '        <bar-style>light-heavy</bar-style>\n'
             '        <ending number="3" type="discontinue"/>\n'
             '      </barline>\n'
             '    </measure>\n')

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <movement-title>Two-Part Test Song</movement-title>
  <part-list>
    <score-part id="P1"><part-name>Voice 1</part-name></score-part>
    <score-part id="P2"><part-name>Voice 2</part-name></score-part>
  </part-list>
  <part id="P1">
{p1}  </part>
  <part id="P2">
{p2}  </part>
</score-partwise>
"""


if __name__ == '__main__':
    import sys
    sys.stdout.write(build())
