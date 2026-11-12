// Copia los clientes de Saint a la pestaña Clientes de la app (ver utils/clientesSaint.js).
// Uso: node scripts/sincronizarClientesSaint.js [CodVend] [--simular]
//   CodVend: solo los clientes de ese vendedor de Saint (p. ej. V9244494). Sin él, los de todos los vendedores
//            que tengan usuario en la app (Usuarios.cod_vendedor).
//   --simular: muestra lo que haría sin escribir nada.
// Corre aparte del backend: hazlo cuando nadie esté registrando clientes.
require('dotenv').config({ quiet: true });
const { sincronizarClientesSaint } = require('../utils/clientesSaint');

const argumentos = process.argv.slice(2);
const simular = argumentos.includes('--simular');
const codVendedor = argumentos.find((a) => !a.startsWith('--')) ?? '';

sincronizarClientesSaint({ codVendedor, simular })
    .then((r) => {
        console.log(simular ? 'SIMULACIÓN (no se escribió nada)' : 'Sincronización terminada');
        console.log(`  Nuevos: ${r.nuevos.length} · Actualizados: ${r.actualizados.length} · Sin cambios: ${r.sin_cambios}`);
        for (const [idVendedor, total] of Object.entries(r.por_vendedor)) console.log(`  ${idVendedor}: ${total} clientes de Saint`);
        r.actualizados.slice(0, 20).forEach((a) => console.log(`  ~ ${a.id_cliente} ${a.nombre}: ${a.campos.join(', ')}`));
        if (r.sin_usuario.length) {
            console.log('  Vendedores de Saint sin usuario en la app (sus clientes no se copiaron):');
            r.sin_usuario.forEach((s) => console.log(`    ${s.cod_vendedor}: ${s.clientes}`));
        }
    })
    .catch((error) => {
        console.error('Error al sincronizar los clientes:', error.message);
        process.exit(1);
    });
