/**
 * Строка перевода, внутри которой одна команда бота набрана моноширинно.
 *
 * Написать `{текст} <code>/panel</code>` нельзя: в русском команда стоит в
 * конце и точка после неё оказалась бы перед командой, а в английском фраза
 * строится иначе. Поэтому подстановка идёт по месту плейсхолдера — где бы
 * его ни поставил переводчик.
 */
export function CommandText({ text, command }: { text: string; command: string }) {
  // \u0000 в переводах не встречается — по нему и режем.
  const [before = '', after = ''] = text.split('\u0000')
  return (
    <>
      {before}
      <code className="rounded-[4px] bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px]">
        {command}
      </code>
      {after}
    </>
  )
}
