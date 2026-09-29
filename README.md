# Agenda de Salas — SVN Investimentos (Campo Grande/MS)

Sistema de reserva das salas de reunião do escritório. Vite + React + TypeScript, publicado no **GitHub Pages**: https://lucascampanini.github.io/agenda-salas-svn/

O Supabase cuida do banco, do login, do tempo real e da Edge Function `admin-users`.

As regras críticas moram **no banco**, não só na tela:

- **Sem sobreposição:** exclusion constraint `bookings_no_overlap` (btree_gist + `tstzrange &&`).
- **Dias e horários válidos:** o trigger `validate_booking` só aceita segunda a sexta, dentro do horário de funcionamento, em blocos certos e nunca no passado.
- **Permissões:** Row Level Security. Usuário comum só cria e cancela as próprias reservas; só admin mexe em salas; perfis só mudam pela Edge Function `admin-users`, que confere se quem chama é admin e usa a service role key dentro do Supabase. A chave nunca vai para o navegador.

## Cadastrar usuários

O cadastro público fica desligado. Só um administrador cria contas.

1. Entre no site com uma conta de administrador e clique em **Admin → Usuários**.
2. Em **Novo usuário**, preencha nome, e-mail e senha inicial (o botão **Gerar** cria uma senha aleatória). Marque **Administrador** se for o caso.
3. Clique em **Criar usuário** e envie o e-mail e a senha ao colega. A conta já nasce confirmada.

Na mesma tela você pode **Tornar admin / Remover admin**, **Desativar / Reativar** (bloqueia o login na hora, sem apagar o histórico) e definir **Nova senha**.

### Primeiro administrador

O primeiro administrador precisa ser criado pelo painel do Supabase:

1. Supabase → **Authentication → Users → Add user → Create new user**. Informe e-mail e senha e marque **Auto Confirm User**.
2. Supabase → **SQL Editor**, rode o comando abaixo trocando o e-mail e o nome:

   ```sql
   update public.profiles
   set is_admin = true, full_name = 'Seu Nome'
   where email = 'seu-email@svninvestimentos.com.br';
   ```

## Alterar horários de funcionamento

O horário fica na tabela `settings` (uma linha só). No **SQL Editor** do Supabase:

```sql
-- Exemplo: das 07:30 às 19:00
update public.settings set open_time = '07:30', close_time = '19:00';

-- Blocos de 15 minutos em vez de 30 (valores aceitos: 10, 15, 20, 30, 60)
update public.settings set slot_minutes = 15;

-- Conferir
select * from public.settings;
```

A grade e a validação do banco passam a usar os novos valores assim que a página for recarregada, sem novo deploy. Reservas já existentes não mudam. O banco recusa combinações inválidas, como abrir depois de fechar ou blocos que não cabem certinho no expediente.

Os dias úteis (segunda a sexta) estão fixos no trigger `validate_booking` e na grade (`weekDays` em `src/lib/time.ts`).

## Salas

Em **Admin → Salas** você cria, renomeia e exclui salas. Excluir uma sala apaga as reservas dela, e a tela avisa quantas reservas futuras serão perdidas antes de confirmar.

## Publicação e configuração

- **Site:** cada push na branch `main` roda o workflow `.github/workflows/deploy.yml`, que gera o build e publica no GitHub Pages.
- **Chaves públicas:** ficam em GitHub → Settings → Secrets and variables → Actions → **Variables**:
  - `VITE_SUPABASE_URL`: URL do projeto Supabase;
  - `VITE_SUPABASE_ANON_KEY`: chave anon/publishable. É pública por design; quem protege os dados é o RLS.

  Depois de mudar uma delas, rode o workflow de novo em Actions → Publicar no GitHub Pages → Run workflow.
- **Service role key:** não fica em nenhum arquivo nem no GitHub. O Supabase injeta essa chave sozinho na Edge Function.
- **Edge Function:** o código está em `supabase/functions/admin-users/index.ts`. Para atualizar, vá em Supabase → Edge Functions → `admin-users` → Code, cole o arquivo e clique em **Deploy**.

## Estrutura

```
supabase/schema.sql      script completo do banco (pode rodar mais de uma vez)
supabase/functions/admin-users/index.ts   Edge Function: criar/desativar usuários, admin, senha
.github/workflows/deploy.yml   publicação automática no GitHub Pages
src/App.tsx              sessão, carregamento de dados, tempo real, navegação
src/components/          grade do dia, formulário, painel lateral, admin
src/lib/time.ts          conversões de fuso (America/Campo_Grande)
```

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha a URL e a chave anon
npm run dev
```

O painel de usuários chama a Edge Function publicada no Supabase, então funciona igual em modo local.
