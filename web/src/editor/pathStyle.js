// 路径双风格纯转换：Windows（C:\foo\bar）⇄ WSL（/mnt/c/foo/bar）。
// 两个函数都能识别两种输入形式，转不了的（/home/... 或相对路径）原样返回。
// 这样旧数据（chip 存 /mnt/c/...）无需迁移，新数据（C:\...）也无需归一。
const WIN_RE = /^([a-zA-Z]):[\\/](.*)$/
const WSL_RE = /^\/mnt\/([a-z])\/(.*)$/

export function toWin(p) {
  const m = p.match(WSL_RE)
  return m ? `${m[1].toUpperCase()}:\\${m[2].replaceAll('/', '\\')}` : p
}

export function toWsl(p) {
  const m = p.match(WIN_RE)
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replaceAll('\\', '/')}` : p
}
