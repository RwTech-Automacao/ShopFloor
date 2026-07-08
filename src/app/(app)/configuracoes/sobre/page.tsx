export default function SobrePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Sobre o Sistema</h1>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex gap-2"><dt className="font-medium">Sistema:</dt><dd>ShopFloor — Enterplak MES</dd></div>
        <div className="flex gap-2"><dt className="font-medium">Versão:</dt><dd>1.0.0</dd></div>
        <div className="flex gap-2"><dt className="font-medium">Empresa:</dt><dd>Enterplak Indústria Eletrônica Ltda.</dd></div>
      </dl>
    </div>
  )
}
